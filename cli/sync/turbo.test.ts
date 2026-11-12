import fs from "node:fs";
import path from "node:path";

import { expect, it } from "vitest";

import { BASE_CONFIG } from "../__fixtures__/base-config.ts";
import type { Pack } from "../config.ts";
import type { TurboTask } from "../turbo-config.ts";
import { put, tempDir, useTempDirs } from "./__fixtures__/temp-dirs.ts";
import { untrackedEntries } from "./git-files.ts";
import { MANIFEST_REL, renderManifest } from "./manifest.ts";
import type { SyncContext } from "./outputs.ts";
import { turbo, type TurboJson } from "./turbo.ts";

useTempDirs();

/** A temp root holding `files`, and a context that reads them from it. */
function context(packs: Pack[], files: Record<string, string> = {}, tasks?: Record<string, TurboTask>): SyncContext {
  const root = tempDir("workerstack-turbo-");

  for (const [rel, text] of Object.entries(files)) put(root, rel, text);
  const turboConfig = tasks === undefined ? {} : { turbo: { tasks } };

  return {
    config: { agents: { hosts: [], skills: [] }, packs, ...BASE_CONFIG, ...turboConfig },
    read: (rel) => (fs.existsSync(path.join(root, rel)) ? fs.readFileSync(path.join(root, rel), "utf8") : null),
    root,
    workspace: { manifest: {}, packages: [], root },
  };
}

const BASE = {
  $schema: "https://turborepo.com/schema.json",
  globalDependencies: ["bun.lock", "package.json", "workerstack.config.ts"],
  tasks: {
    test: {
      env: ["REPO_COVERAGE", "REPO_VITEST_REPORT", "REPO_VITEST_SHARD"],
      outputs: ["coverage/**", ".turbo/vitest-report.json"],
    },
    typecheck: { outputs: [] },
  },
};

function json(value: TurboJson) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

it("turbo: writes Usage's turbo.json as an ignored whole file", () => {
  expect(turbo(context(["workspace"]))).toStrictEqual({
    errors: [],
    outputs: [{ content: json(BASE), kind: "file", managed: "whole", path: "turbo.json", tracked: false }],
  });
});

it("turbo: merges turbo.tasks after the generated tasks", () => {
  const deploy = { cache: false, dependsOn: ["^build"] };
  const { outputs } = turbo(context(["workspace"], {}, { deploy }));
  const expected = { ...BASE, tasks: { ...BASE.tasks, deploy } };
  expect(outputs).toStrictEqual([
    { content: json(expected), kind: "file", managed: "whole", path: "turbo.json", tracked: false },
  ]);
});

it("turbo: gives nothing without the workspace pack", () => {
  expect(turbo(context(["standards"], { "turbo.json": "{}" }))).toStrictEqual({ errors: [], outputs: [] });
});

it("turbo: refuses a hand-written turbo.json", () => {
  expect(turbo(context(["workspace"], { "turbo.json": '{ "tasks": {} }\n' }))).toStrictEqual({
    errors: ["turbo.json is hand-written; delete it so repo sync can own it, and move its tasks to turbo.tasks"],
    outputs: [],
  });
});

it("turbo: owns a turbo.json it would write itself", () => {
  expect(turbo(context(["workspace"], { "turbo.json": json(BASE) })).errors).toStrictEqual([]);
});

it("turbo: owns a turbo.json the sync manifest lists, and rewrites it", () => {
  const files = { [MANIFEST_REL]: renderManifest(["turbo.json"]), "turbo.json": '{ "tasks": {} }\n' };
  const result = turbo(context(["workspace"], files));
  expect(result.errors).toStrictEqual([]);
  expect(result.outputs).toHaveLength(1);
});

it("turbo: ignores .turbo/ along with turbo.json", () => {
  const { outputs } = turbo(context(["workspace"]));
  expect(untrackedEntries([], outputs)).toStrictEqual(["turbo.json", ".turbo/"]);
  expect(untrackedEntries([], [])).toStrictEqual([]);
});

it("turbo: the test task keys its cache on the shard, so one shard never replays another's run", () => {
  const [output] = turbo(context(["workspace"])).outputs;
  expect(output?.kind === "file" && JSON.parse(output.content)).toMatchObject({
    tasks: { test: { env: ["REPO_COVERAGE", "REPO_VITEST_REPORT", "REPO_VITEST_SHARD"] } },
  });
});
