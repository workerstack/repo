import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { BASE_CONFIG } from "../fixtures/base-config.ts";
import type { Pack } from "../config.ts";
import type { TurboTask } from "../turbo-config.ts";
import { untrackedEntries } from "./git-files.ts";
import { MANIFEST_REL, renderManifest } from "./manifest.ts";
import type { SyncContext } from "./outputs.ts";
import { turbo } from "./turbo.ts";

const temps: string[] = [];
afterEach(() => {
  for (const dir of temps.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

/** A temp root holding `files`, and a context that reads them from it. */
function context(packs: Pack[], files: Record<string, string> = {}, tasks?: Record<string, TurboTask>): SyncContext {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "workerstack-turbo-"));
  temps.push(root);
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), text);
  }
  return {
    root,
    config: { packs, agents: { hosts: [], skills: [] }, ...BASE_CONFIG, ...(tasks ? { turbo: { tasks } } : {}) },
    workspace: { root, manifest: {}, packages: [] },
    read: (rel) => (fs.existsSync(path.join(root, rel)) ? fs.readFileSync(path.join(root, rel), "utf8") : null),
  };
}

const BASE = {
  $schema: "https://turborepo.com/schema.json",
  globalDependencies: ["bun.lock", "package.json", "workerstack.config.ts"],
  tasks: {
    typecheck: { outputs: [] },
    test: {
      env: ["REPO_COVERAGE", "REPO_VITEST_REPORT", "REPO_VITEST_SHARD"],
      outputs: ["coverage/**", ".turbo/vitest-report.json"],
    },
  },
};
const json = (value: object) => `${JSON.stringify(value, null, 2)}\n`;

it("turbo: writes Usage's turbo.json as an ignored whole file", () => {
  expect(turbo(context(["workspace"]))).toStrictEqual({
    outputs: [{ kind: "file", path: "turbo.json", content: json(BASE), tracked: false, managed: "whole" }],
    errors: [],
  });
});

it("turbo: merges turbo.tasks after the generated tasks", () => {
  const deploy = { cache: false, dependsOn: ["^build"] };
  const { outputs } = turbo(context(["workspace"], {}, { deploy }));
  const expected = { ...BASE, tasks: { ...BASE.tasks, deploy } };
  expect(outputs).toStrictEqual([
    { kind: "file", path: "turbo.json", content: json(expected), tracked: false, managed: "whole" },
  ]);
});

it("turbo: gives nothing without the workspace pack", () => {
  expect(turbo(context(["standards"], { "turbo.json": "{}" }))).toStrictEqual({ outputs: [], errors: [] });
});

it("turbo: refuses a hand-written turbo.json", () => {
  expect(turbo(context(["workspace"], { "turbo.json": '{ "tasks": {} }\n' }))).toStrictEqual({
    outputs: [],
    errors: ["turbo.json is hand-written; delete it so repo sync can own it, and move its tasks to turbo.tasks"],
  });
});

it("turbo: owns a turbo.json it would write itself", () => {
  expect(turbo(context(["workspace"], { "turbo.json": json(BASE) })).errors).toStrictEqual([]);
});

it("turbo: owns a turbo.json the sync manifest lists, and rewrites it", () => {
  const files = { "turbo.json": '{ "tasks": {} }\n', [MANIFEST_REL]: renderManifest(["turbo.json"]) };
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
