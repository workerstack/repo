import fs from "node:fs";
import path from "node:path";

import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { useTempDirs } from "../sync/fixtures/temp-dirs.ts";
import { git, indexText, lesson, repo, save } from "./fixtures/lessons-kit.ts";
import { LESSONS_DIR } from "./lessons.constants.ts";
import { main } from "./lessons.ts";
import { resolveRoots } from "./workspace-root.ts";

useTempDirs();

let out: string[];
let err: string[];

beforeEach(() => {
  out = [];
  err = [];
  vi.spyOn(process.stdout, "write").mockImplementation((s) => out.push(String(s)) > 0);
  vi.spyOn(process.stderr, "write").mockImplementation((s) => err.push(String(s)) > 0);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

/** Runs `main` as `bun repo lessons <argv>` run from `cwd` in the checkout `ws`. */
function run(ws: string, argv: string[], cwd = ws) {
  return main(argv, () => resolveRoots({ workspaceRoot: ws }, { cwd }));
}

const USAGE = /^usage: bun repo lessons match/;

it("prints the lessons that match the files named", () => {
  const ws = repo();
  save(ws, "plan-forks", lesson({ hits: 2 }));
  expect(run(ws, ["match", "src/a.ts"])).toBe(0);
  expect(out).toStrictEqual([".repo/lessons/plan-forks.md (hits 2): Rewriting a saved plan minted a new serial.\n"]);
});

it("prints nothing for a file no lesson covers", () => {
  const ws = repo();
  save(ws, "plan-forks", lesson());
  expect(run(ws, ["match", "docs/x.md"])).toBe(0);
  expect(out).toStrictEqual([]);
});

it("counts a hit and prints the new total", () => {
  const ws = repo();
  save(ws, "plan-forks", lesson());
  expect(run(ws, ["hit", "plan-forks", "--evidence", "plan 17"])).toBe(0);
  expect(out).toStrictEqual([".repo/lessons/plan-forks.md hits 2\n"]);
});

it("fails a hit on a lesson that does not exist", () => {
  expect(run(repo(), ["hit", "ghost", "--evidence", "e"])).toBe(1);
  expect(err).toStrictEqual(["no lesson ghost; write .repo/lessons/ghost.md first\n"]);
});

it("removes a lesson and fails removing one that is gone", () => {
  const ws = repo();
  save(ws, "plan-forks", lesson());
  expect(run(ws, ["rm", "plan-forks"])).toBe(0);
  expect(fs.existsSync(path.join(ws, LESSONS_DIR, "plan-forks.md"))).toBe(false);
  expect(run(ws, ["rm", "plan-forks"])).toBe(1);
  expect(err).toStrictEqual(["no lesson plan-forks\n"]);
});

it("rewrites the index", () => {
  const ws = repo();
  save(ws, "plan-forks", lesson());
  fs.chmodSync(path.join(ws, LESSONS_DIR, "INDEX.md"), 0o644);
  fs.writeFileSync(path.join(ws, LESSONS_DIR, "INDEX.md"), "stale\n");
  expect(run(ws, ["index"])).toBe(0);
  expect(indexText(ws)).toContain("plan-forks.md");
});

it("refuses to rewrite the index in a committed main checkout", () => {
  const ws = repo();
  git(ws, "init", "-q");
  save(ws, "plan-forks", lesson());
  git(ws, "add", "-A");
  git(ws, "commit", "-qm", "init");
  expect(run(ws, ["index"])).toBe(1);
  expect(err[0]).toContain("the main checkout is shared");
});

it("checks quietly when the lessons are sound and lists each problem when not", () => {
  const ws = repo();
  save(ws, "plan-forks", lesson());
  expect(run(ws, ["check"])).toBe(0);
  expect(err).toStrictEqual([]);
  fs.chmodSync(path.join(ws, LESSONS_DIR, "INDEX.md"), 0o644);
  fs.writeFileSync(path.join(ws, LESSONS_DIR, "INDEX.md"), "stale\n");
  expect(run(ws, ["check"])).toBe(1);
  expect(err[0]).toMatch(/INDEX\.md is out of date/);
});

it("prints usage for a missing or incomplete command", () => {
  const ws = repo();
  const bad = [
    [],
    ["nope"],
    ["match"],
    ["hit"],
    ["hit", "plan-forks"],
    ["hit", "--evidence", "e"],
    ["hit", "plan-forks", "--evidence"],
    ["rm"],
    ["index", "extra"],
    ["check", "extra"],
  ];
  for (const argv of bad) {
    err.length = 0;
    expect(run(ws, argv), argv.join(" ")).toBe(1);
    expect(err[0]).toMatch(USAGE);
  }
});

it("reports a thrown error by its message", () => {
  const roots = () => {
    throw new Error("no roots");
  };
  expect(main(["check"], roots)).toBe(1);
  expect(err).toStrictEqual(["no roots\n"]);
});

it("takes the roots of the working directory when none are given", () => {
  const ws = repo();
  save(ws, "plan-forks", lesson());
  vi.spyOn(process, "cwd").mockReturnValue(ws);
  vi.stubEnv("CLAUDE_PROJECT_DIR", ws);
  vi.stubEnv("GROK_WORKSPACE_ROOT", "");
  expect(main(["match", "src/a.ts"])).toBe(0);
  expect(out).toHaveLength(1);
});
