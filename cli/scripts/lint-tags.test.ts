import fs from "node:fs";
import path from "node:path";

import { expect, it } from "vitest";
import { z } from "zod";

import { loadConfig } from "../config.ts";
import { readJson } from "../json.ts";
import { TAGGED_BOUNDARIES, taggedTree } from "../sync/__fixtures__/tagged-kit.ts";
import { put, useTempDirs } from "../sync/__fixtures__/temp-dirs.ts";
import { standards } from "../sync/standards.ts";
import { readWorkspace } from "../sync/workspace.ts";
import { captureTool } from "./lint.ts";

const SLOW = 60_000;

/** The consumer is untyped (no install), so only the rule under test is read from oxlint's report. */
const RULE = "[Error/repo(boundaries)]";

useTempDirs();

/** Runs the standards pass of sync over the tree at `root`, as `repo sync` does, and writes what it outputs. */
async function syncStandards(root: string): Promise<string[]> {
  const loaded = await loadConfig(root);
  const read = readWorkspace(root);

  if (!loaded.ok || !read.ok) throw new Error("the tagged tree did not load");
  const ctx = { config: loaded.config, read: () => null, root, workspace: read.workspace };
  const result = standards(ctx, []);

  for (const output of result.outputs) if (output.kind === "file") put(root, output.path, output.content);

  return result.errors;
}

it("a tagged workspace fails only lib's import of ui, under the options sync writes", { timeout: SLOW }, async () => {
  const root = taggedTree();
  expect(await syncStandards(root)).toStrictEqual([]);
  const text = fs.readFileSync(path.join(root, ".oxlintrc.jsonc"), "utf8");
  const written = readJson(z.object({ rules: z.record(z.string(), z.json()) }), text);
  expect(written.rules["repo/boundaries"]).toStrictEqual(["error", TAGGED_BOUNDARIES]);
  const run = captureTool("oxlint", ["-f", "unix"], root);
  expect(run.stdout.split("\n").filter((line) => line.endsWith(RULE))).toStrictEqual([
    'packages/lib/src/lib.ts:1:1: "@tagged/ui" is a ui package, and a lib package may import only lib; move what it ' +
      `needs into a package lib may import, or add "ui" to lint.boundaries.allow.lib in repo.config.ts ${RULE}`,
  ]);
});

it("sync refuses a tag naming a package the workspace lacks, writing nothing", { timeout: SLOW }, async () => {
  const root = taggedTree({ ...TAGGED_BOUNDARIES, tags: { ...TAGGED_BOUNDARIES.tags, "@tagged/gone": "lib" } });
  expect(await syncStandards(root)).toStrictEqual([
    'repo.config.ts: lint.boundaries.tags: "@tagged/gone" is not a workspace package',
  ]);
  expect(fs.existsSync(path.join(root, ".oxlintrc.jsonc"))).toBe(false);
});
