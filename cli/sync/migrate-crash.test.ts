import fs from "node:fs";
import path from "node:path";

import { afterAll, expect, it } from "vitest";

import { loadConfig } from "../config.ts";
import { removeTree } from "../remove-tree.ts";
import { runSync, type SyncDeps } from "../sync.ts";
import {
  LINES,
  copied,
  copiedPlan,
  dropFixture,
  exists,
  git,
  migrate,
  read,
  snapshot,
  sync,
  write,
} from "./__fixtures__/copied-install.ts";
import { useTempDirs } from "./__fixtures__/temp-dirs.ts";
import { applyMigration } from "./apply-migration.ts";
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

/** The reference run, started on first use and shared by every crash point. */
type Taken = { reference?: Promise<Reference> };

const taken: Taken = {};

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
  removeTree(path.join(root, ".rulesync", "rules"));
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

/** Fails the plan once the skill rename after the migration wrote the new name into the moved rule. */
function renameRefused(ctx: { read: (rel: string) => string | null }) {
  return ctx.read(".repo/rules/team.md")?.includes("/write-plan-deep") === true
    ? { errors: ["generator saw the renamed skill"], outputs: [] }
    : { errors: [], outputs: [] };
}

/** repo sync in `root` with `deps` and no post passes; its exit code and stderr. */
async function syncWith(root: string, deps: SyncDeps): Promise<{ code: number; err: string[] }> {
  const err: string[] = [];
  const code = await runSync([], { cwd: root, stderr: (s) => err.push(s), stdout: () => {} }, { post: [], ...deps });

  return { code, err };
}

it("reports a generator error the skill rename after the migration causes, the rename kept", async () => {
  const root = copied();
  write(root, ".rulesync/rules/team.md", "Run /write-plan first.\n");
  const { code, err } = await syncWith(root, { generators: [renameRefused] });

  expect(code).toBe(1);
  expect(err[0]).toBe("repo sync: generator saw the renamed skill\n");
  expect(read(root, ".repo/rules/team.md")).toBe("Run /write-plan-deep first.\n");
});

it("reports a config that no longer loads after the migration", async () => {
  const root = copied();
  let loads = 0;

  function load(dir: string): ReturnType<typeof loadConfig> {
    loads += 1;

    return loads === 1 ? loadConfig(dir) : Promise.resolve({ errors: ["repo.config.ts: copy refused"], ok: false });
  }

  const { code, err } = await syncWith(root, { generators: [], load });

  expect(code).toBe(1);
  expect(err.join("")).toContain("copy refused");
  expect(exists(root, COPIED_MARKER)).toBe(false);
});
