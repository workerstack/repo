import fs from "node:fs";
import path from "node:path";

import { expect, it } from "vitest";

import { aliasOf } from "../../dev/test-paths";
import { useTempDirs } from "../sync/__fixtures__/temp-dirs.ts";
import { git, lesson, repo, runLessons, save } from "./__fixtures__/lessons-kit.ts";
import { LESSONS_DIR } from "./lessons.constants.ts";

useTempDirs();

it("matches, hits, and checks from the command line", () => {
  const ws = repo();
  save(ws, "plan-forks", lesson());
  const m = runLessons(ws, "match", "src/a.ts");
  expect(m.status, m.stderr).toBe(0);
  expect(m.stdout).toContain(".repo/lessons/plan-forks.md");
  expect(runLessons(ws, "hit", "plan-forks", "--evidence", "plan 17").status).toBe(0);
  expect(runLessons(ws, "check").status).toBe(0);
});

it("matches against the checkout's lessons from a subdir and from a worktree", () => {
  const ws = repo(["packages/a/src/x.ts"]);
  git(ws, "init", "-q");
  save(ws, "pkg-a", lesson({ name: "pkg-a", paths: ["packages/a/**"] }));
  git(ws, "add", "-A");
  git(ws, "commit", "-qm", "init");
  const sub = runLessons(path.join(ws, "packages/a"), "match", "src/x.ts");
  expect(sub.status, sub.stderr).toBe(0);
  expect(sub.stdout).toContain(".repo/lessons/pkg-a.md");
  const typed = runLessons(ws, "match", path.join(aliasOf(ws), "packages/a/src/x.ts"));
  expect(typed.stdout).toContain(".repo/lessons/pkg-a.md");
  git(ws, "worktree", "add", "-q", ".worktrees/w", "-b", "wt/w");
  fs.rmSync(path.join(ws, LESSONS_DIR), { recursive: true });
  const wt = runLessons(path.join(ws, ".worktrees/w/packages/a"), "match", "src/x.ts");
  expect(wt.status, wt.stderr).toBe(0);
  expect(wt.stdout).toContain(".repo/lessons/pkg-a.md");
});

it("exits non-zero on bad args", () => {
  const ws = repo();

  for (const args of [[], ["nope"], ["hit", "plan-forks"], ["match"], ["rm"]]) {
    const r = runLessons(ws, ...args);
    expect(r.status, args.join(" ")).not.toBe(0);
    expect(r.stderr).toMatch(/usage/);
  }
});
