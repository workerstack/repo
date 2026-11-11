import fs from "node:fs";
import path from "node:path";

import { afterAll, expect, it } from "vitest";

import { HOSTS, loadConfig } from "../config.ts";
import { DEFAULT_COVERAGE } from "../coverage-config.ts";
import { DEFAULT_NIGHTLY } from "../nightly-config.ts";
import { applyMigration } from "./apply-migration.ts";
import {
  FINAL,
  FINAL_NO_GIT,
  LINES,
  UNTRACKED,
  copied,
  copiedPlan,
  dropFixture,
  exists,
  fixtureDir,
  fixturePlanned,
  git,
  migrate,
  read,
  readJson,
  snapshot,
  stockOf,
  sync,
  write,
} from "./fixtures/copied-install.ts";
import { useTempDirs } from "./fixtures/temp-dirs.ts";
import { COPIED_MARKER } from "./migrate.constants.ts";
import { conflictLines, planMigration } from "./migrate.ts";

useTempDirs();
afterAll(dropFixture);

const TEAM_CLASH =
  "repo sync: cannot move .rulesync/rules/team.md: .repo/rules/team.md already exists and differs; " +
  "merge them by hand, then run `bun repo sync`";

/** The consumer's own files the migration of the recorded install moved, each with its text. */
function expectMovedOwnFiles(root: string): void {
  const fixture = fixtureDir();
  expect(read(root, ".repo/rules/team.md")).toBe(read(fixture, ".rulesync/rules/team.md"));
  expect(read(root, ".repo/subagents/reviewer.md")).toBe(read(fixture, ".rulesync/subagents/reviewer.md"));
  expect(read(root, ".repo/skills/deploy/SKILL.md")).toBe(read(fixture, ".agents/skills/deploy/SKILL.md"));
  expect(read(root, "references/deploy.md")).toBe("# Deploy\n\nHow we deploy: `make deploy`.\n");
  expect(read(root, "references/hooks.md")).toBe(
    "# Hooks\n\n## Our hooks\n\nWe also run `make lint` from a pre-push hook.\n",
  );
  expect(exists(root, ".repo/rules/agents.md")).toBe(false);
  expect(readJson<unknown>(root, ".repo/settings/claude.json")).toStrictEqual({
    permissions: { allow: ["Bash(make lint:*)"] },
  });
  expect(read(root, ".repo/lessons/x.md")).toBe(read(fixture, ".rulesync/lessons/x.md"));
  expect(exists(root, ".repo/lessons/INDEX.md")).toBe(false);
  expect(read(root, ".repo/hooks.jsonc")).toBe(read(fixture, ".rulesync/hooks.jsonc"));
  expect(read(root, ".repo/mcp-policy.jsonc")).toBe(read(fixture, ".rulesync/mcp-policy.jsonc"));
  expect(read(root, "workerstack.config.ts")).toBe(
    'import { defineConfig } from "@workerstack/repo"\n\nexport default defineConfig({\n' +
      '  agents: { skills: ["listen"] },\n  packs: ["agents", "docs"],\n})\n',
  );
}

/** What the migration of the recorded install left: no stock copies, generated trees untracked but on disk. */
function expectOnlyGeneratedLeft(root: string): void {
  // stock-only copies are gone: the whole copied tree and every stock skill copy
  expect(exists(root, ".rulesync")).toBe(false);
  expect(exists(root, ".agents/skills/ask")).toBe(false);
  expect(exists(root, ".agents/skills/deploy")).toBe(false);
  // untracked, not deleted: generated trees stay for sync, the shared AGENTS.md stays tracked; the settings file
  // whose own keys moved is gone
  expect(exists(root, ".claude/agents/scout.md")).toBe(true);
  expect(exists(root, "AGENTS.md")).toBe(true);
  expect(exists(root, ".claude/settings.json")).toBe(false);
  const tracked = git(root, "ls-files").split("\n");
  for (const dir of [".agents/", ".claude/", ".codex/", ".cursor/", ".grok/"])
    expect(tracked.filter((file) => file.startsWith(dir) || file === dir)).toStrictEqual([]);

  expect(tracked).toContain(".mcp.json");
  expect(tracked).toContain("AGENTS.md");
  expect(tracked).toContain(".vscode/tasks.json");
  expect(tracked).toContain("package.json");
}

it("is empty without the copied-install marker", async () => {
  const root = copied({ git: false });
  fs.rmSync(path.join(root, COPIED_MARKER));
  expect(await copiedPlan(root)).toStrictEqual([]);
});

it("names the moves in the order of Usage, then one untrack and one removal", async () => {
  const steps = await copiedPlan(copied());
  const printed = steps.flatMap((step) => ("note" in step ? [`repo sync: ${step.note}`] : []));
  expect(printed).toStrictEqual(LINES);
  expect(steps.map((step) => step.kind).slice(-2)).toStrictEqual(["untrack", "remove"]);
  expect(steps.find((step) => step.kind === "untrack")).toStrictEqual({
    kind: "untrack",
    paths: UNTRACKED.split(", "),
  });
});

it("plans the same steps for a root with a trailing separator", async () => {
  const root = copied();
  expect(planMigration(`${root}${path.sep}`, { stock: stockOf(root), ...(await fixturePlanned()) })).toStrictEqual(
    await copiedPlan(root),
  );
});

it("moves each file, prints each line and leaves only generated paths behind", async () => {
  const root = copied();
  expect(await migrate(root)).toStrictEqual([...LINES, FINAL]);
  expectMovedOwnFiles(root);
  expectOnlyGeneratedLeft(root);
});

it("leaves a config that still loads, with the pack in agents.skills", async () => {
  const root = copied();
  await migrate(root);
  expect(await loadConfig(root)).toStrictEqual({
    config: {
      agents: { hosts: HOSTS, skills: ["listen"] },
      ci: { checks: {} },
      clean: undefined,
      commit: { maxChangedLines: 1000 },
      coverage: DEFAULT_COVERAGE,
      knip: { ignore: [] },
      link: undefined,
      lint: { skip: [] },
      nightly: DEFAULT_NIGHTLY,
      owner: undefined,
      packs: ["agents", "docs"],
      tdd: false,
      turbo: undefined,
    },
    ok: true,
  });
});

it("plans nothing on a second run", async () => {
  const root = copied();
  await migrate(root);
  const before = snapshot(root);
  expect(await copiedPlan(root)).toStrictEqual([]);
  expect(await migrate(root)).toStrictEqual([]);
  expect(snapshot(root)).toStrictEqual(before);
});

it("skips the untrack step outside git and still removes the copy", async () => {
  const root = copied({ git: false });
  const steps = await copiedPlan(root);
  expect(steps.map((step) => step.kind)).not.toContain("untrack");
  expect(await applyMigration(root, steps)).toStrictEqual([...LINES, FINAL_NO_GIT]);
  expect(exists(root, ".rulesync")).toBe(false);
});

it("stops with one line naming both paths and changes nothing", async () => {
  const root = copied();
  write(root, ".repo/rules/team.md", "other text\n");
  const before = snapshot(root);
  const steps = await copiedPlan(root);
  expect(conflictLines(steps)).toStrictEqual([TEAM_CLASH]);
  expect(await applyMigration(root, steps)).toStrictEqual(conflictLines(steps));
  expect(snapshot(root)).toStrictEqual(before);
  expect(git(root, "ls-files", "AGENTS.md")).toBe("AGENTS.md\n");
});

it("through runSync exits 1 with that line on stderr and writes nothing", async () => {
  const root = copied();
  write(root, ".repo/rules/team.md", "other text\n");
  const before = snapshot(root);
  const result = await sync(root, []);
  expect(result.code).toBe(1);
  expect(result.err).toStrictEqual([`${TEAM_CLASH}\n`]);
  expect(snapshot(root)).toStrictEqual(before);
});

it("goes on when the destination holds the same text", async () => {
  const root = copied();
  write(root, ".repo/rules/team.md", read(root, ".rulesync/rules/team.md"));
  const lines = await migrate(root);
  expect(lines[0]).toBe(LINES[0]);
  expect(exists(root, ".rulesync")).toBe(false);
});
