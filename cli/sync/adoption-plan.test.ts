import fs from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { runSync } from "../sync.ts";
import { planAdoption, type MigrateDeps } from "./migrate.ts";
import type { Output } from "./outputs.ts";
import { hashText } from "./stock-history.ts";
import { CONFIG, copied, dropFixture, exists, git, plain, stockOf, sync, write } from "./fixtures/copied-install.ts";
import { RULE } from "./fixtures/adoption-kit.ts";
import { fileOutput } from "./fixtures/mini-install.ts";
import { useTempDirs } from "./fixtures/temp-dirs.ts";

useTempDirs();
afterAll(dropFixture);

const SETTINGS = ".claude/settings.json";
const BAD = '{"hooks":{"PreToolUse":"x"}}\n';
const SCHEMA_LINE =
  "repo sync: .claude/settings.json: hooks.PreToolUse: Invalid input: expected array, received string\n";
/** Plans a valid settings file until `made` exists, then an invalid one. */
const settingsOnceMade = (made: string) => ({
  generators: [
    (ctx: { read(rel: string): string | null }) => ({
      outputs: [fileOutput(SETTINGS, ctx.read(made) === null ? "{}\n" : BAD)],
      errors: [],
    }),
  ],
});
const run = async (root: string, deps: Parameters<typeof runSync>[2]) => {
  const err: string[] = [];
  const code = await runSync([], { cwd: root, stdout: () => {}, stderr: (s) => err.push(s) }, deps);
  return { code, err };
};

describe("planAdoption on its own", () => {
  const plan = (root: string, outputs: Output[], deps: MigrateDeps = {}) =>
    planAdoption(root, { stock: stockOf(root), config: CONFIG, outputs, manifest: [] }, deps);

  it("plans nothing for an AGENTS.md of any text, or a .mcp.json sync does not generate", () => {
    for (const text of ["  \n", RULE]) {
      const root = plain({ "AGENTS.md": text, ".mcp.json": '{"mcpServers":{"a":{}}}' }, { git: false });
      expect(plan(root, [fileOutput("AGENTS.md", "generated\n")]), text).toEqual([]);
    }
  });

  it("skips a tracked file that is gone, a tracked link, and a tracked copy of a past stock file", () => {
    const root = plain({ ".claude/agents/gone.md": "x\n", ".claude/agents/old.md": "old\n" });
    fs.symlinkSync("../../elsewhere", path.join(root, ".claude", "linked"), "dir");
    git(root, "add", "-A");
    fs.rmSync(path.join(root, ".claude/agents/gone.md"));
    const history = { ".claude/agents/old.md": [hashText("old\n")] };
    expect(plan(root, [], { history })).toEqual([]);
  });
});

it("never adopts in this repo", async () => {
  const self = plain({ "AGENTS.md": RULE }, { git: false });
  write(self, "package.json", JSON.stringify({ name: "@workerstack/repo" }));
  expect((await sync(self, ["--check"], true)).err.join("")).not.toContain("adoption");
}, 180_000);

it("keeps the adoption and writes nothing else when its result is invalid", async () => {
  const root = plain({ [SETTINGS]: '{"model":"opus"}' }, { git: false });
  const result = await run(root, settingsOnceMade(".repo/settings/claude.json"));
  expect(result).toEqual({ code: 1, err: [SCHEMA_LINE, "repo sync: nothing written\n"] });
  expect(exists(root, ".repo/settings/claude.json")).toBe(true);
  expect(exists(root, ".repo/tmp/sync.json")).toBe(false);
});

it("keeps the migration and writes nothing else when its result is invalid", async () => {
  const root = copied({ git: false });
  const result = await run(root, settingsOnceMade(".repo/subagents/reviewer.md"));
  expect(result).toEqual({ code: 1, err: [SCHEMA_LINE, "repo sync: nothing written\n"] });
  expect(exists(root, ".rulesync")).toBe(false);
  expect(exists(root, ".repo/subagents/reviewer.md")).toBe(true);
  expect(exists(root, SETTINGS)).toBe(false);
  expect(exists(root, ".repo/tmp/sync.json")).toBe(false);
});
