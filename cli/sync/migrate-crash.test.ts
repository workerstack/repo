import fs from "node:fs";
import path from "node:path";

import { afterAll, expect, it } from "vitest";

import { loadConfig } from "../config.ts";
import { runSync } from "../sync.ts";
import { applyMigration } from "./apply-migration.ts";
import {
  LINES,
  copied,
  copiedPlan,
  dropFixture,
  exists,
  git,
  migrate,
  snapshot,
  sync,
  write,
} from "./fixtures/copied-install.ts";
import { useTempDirs } from "./fixtures/temp-dirs.ts";
import { trackedRels } from "./migrate-fs.ts";
import { COPIED_MARKER } from "./migrate.constants.ts";
import type { MigrateDeps, MigrationStep } from "./migrate.ts";

useTempDirs();
afterAll(dropFixture);

/** The steps of the recorded install's migration: one per printed line, then the untrack and the removal. */
const STEP_COUNT = LINES.length + 2;
const CRASH_POINTS = Array.from({ length: STEP_COUNT }, (_, index) => index);

/** The plan, end state and index of a migration run whole, taken once for every crash point. */
type Reference = {
  planned: MigrationStep[];
  expected: Record<string, string>;
  expectedTracked: string;
};

const taken: { reference?: Promise<Reference> } = {};

async function takeReference(): Promise<Reference> {
  const reference = copied();
  const planned = await copiedPlan(reference);
  await migrate(reference);
  return { expected: snapshot(reference), expectedTracked: git(reference, "ls-files"), planned };
}

/** Throws right after step `crashAfter` ran. */
function crashing(crashAfter: number): MigrateDeps {
  return {
    afterStep: (index) => {
      if (index === crashAfter) throw new Error("crash");
    },
  };
}

it.each(CRASH_POINTS)(
  "is finished by the next run, whichever step it follows, with the marker removed last: crash after step %i",
  async (crashAfter) => {
    taken.reference ??= takeReference();
    const { planned, expected, expectedTracked } = await taken.reference;
    expect(planned).toHaveLength(STEP_COUNT);
    const root = copied();
    await expect(migrate(root, crashing(crashAfter))).rejects.toThrow("crash");
    const isLast = crashAfter === planned.length - 1;
    expect(exists(root, COPIED_MARKER), `marker after step ${crashAfter} (${planned[crashAfter]?.kind})`).toBe(!isLast);
    if (!isLast) await migrate(root);
    expect(snapshot(root), `after a crash behind step ${crashAfter}`).toStrictEqual(expected);
    expect(git(root, "ls-files")).toBe(expectedTracked);
  },
  60_000,
);

it("replans only the removal when .rulesync/ was half removed", async () => {
  const reference = copied();
  await migrate(reference);

  const root = copied();
  const steps = await copiedPlan(root);
  await applyMigration(root, steps.slice(0, -1));
  fs.rmSync(path.join(root, ".rulesync", "scripts", "browser.ts"));
  fs.rmSync(path.join(root, ".rulesync", "rules"), { recursive: true });
  const rest = await copiedPlan(root);
  expect(rest.map((step) => step.kind)).toStrictEqual(["remove"]);
  await applyMigration(root, rest);
  expect(snapshot(root)).toStrictEqual(snapshot(reference));
});

it("reads tracked paths with backslashes or a drive prefix as root-relative posix paths", () => {
  expect(
    trackedRels(
      [
        "AGENTS.md",
        ".claude\\settings.json",
        "C:\\proj\\.agents\\skills\\ask\\SKILL.md",
        "c:/PROJ/.grok/config.toml",
        "D:\\elsewhere\\x",
        "",
      ],
      "C:\\proj",
    ),
  ).toStrictEqual(["AGENTS.md", ".claude/settings.json", ".agents/skills/ask/SKILL.md", ".grok/config.toml"]);
});

it("plans the same untrack paths from git output in either spelling", async () => {
  const root = copied();
  const posix = await copiedPlan(root);
  const spelled = await copiedPlan(root, {
    tracked: () => [
      "AGENTS.md",
      ".mcp.json",
      `${root.replaceAll("/", "\\")}\\.agents\\skills\\ask\\SKILL.md`,
      ".claude\\settings.json",
      ".codex\\config.toml",
      ".cursor\\hooks.json",
      ".grok\\config.toml",
    ],
  });
  expect(spelled).toStrictEqual(posix);
});

it("reports a conflict as exit 0 under --postinstall, and a failed untrack as an error", async () => {
  const conflict = copied();
  write(conflict, ".repo/rules/team.md", "other\n");
  const result = await sync(conflict, ["--postinstall"]);
  expect(result.code).toBe(0);
  expect(result.err).toHaveLength(1);

  const locked = copied();
  fs.writeFileSync(path.join(locked, ".git", "index.lock"), "");
  const failed = await sync(locked, [], true);
  expect(failed.code).toBe(1);
  expect(failed.err).toStrictEqual([expect.stringMatching(/^repo sync: git rm --cached failed: /)]);
  expect(exists(locked, COPIED_MARKER)).toBe(true);
});

it("reports a config that no longer loads after the migration", async () => {
  const root = copied();
  let loads = 0;
  function load(dir: string): ReturnType<typeof loadConfig> {
    loads += 1;
    return loads === 1
      ? loadConfig(dir)
      : Promise.resolve({ errors: ["workerstack.config.ts: copy refused"], ok: false });
  }
  const err: string[] = [];
  const code = await runSync(
    [],
    { cwd: root, stderr: (s) => err.push(s), stdout: () => {} },
    { generators: [], load, post: [] },
  );
  expect(code).toBe(1);
  expect(err.join("")).toContain("copy refused");
  expect(exists(root, COPIED_MARKER)).toBe(false);
});
