import fs from "node:fs";
import path from "node:path";

import { expect, it, vi } from "vitest";

import { useTempDirs } from "../sync/__fixtures__/temp-dirs.ts";
import { git, lesson, repo, save } from "./__fixtures__/lessons-kit.ts";
import { matchLessons } from "./lessons-ops.ts";
import { LESSONS_DIR } from "./lessons.constants.ts";
import { resolveRoots } from "./workspace-root.ts";

useTempDirs();

function names(rows: { file: string }[]) {
  return rows.map((r) => path.basename(r.file));
}

it("breaks a tie of hits by file name", () => {
  const ws = repo();
  save(ws, "b-one", lesson({ name: "b-one" }));
  save(ws, "a-one", lesson({ name: "a-one" }));
  expect(names(matchLessons({ files: ["src/a.ts"], workspaceRoot: ws }))).toStrictEqual(["a-one.md", "b-one.md"]);
});

it("finds a lesson in a checkout with no INDEX.md", () => {
  const ws = repo();
  save(ws, "plan-forks", lesson());
  fs.rmSync(path.join(ws, LESSONS_DIR, "INDEX.md"));
  expect(matchLessons({ files: ["src/a.ts"], workspaceRoot: ws })).toMatchObject([
    { paths: ["src/**"], title: "Plan rewrites fork serials" },
  ]);
});

it("finds a lesson a Windows checkout turned to CRLF", () => {
  const ws = repo();
  save(ws, "plan-forks", lesson());
  const file = path.join(ws, LESSONS_DIR, "plan-forks.md");
  fs.writeFileSync(file, fs.readFileSync(file, "utf8").replaceAll("\n", "\r\n"));
  expect(names(matchLessons({ files: ["src/a.ts"], workspaceRoot: ws }))).toStrictEqual(["plan-forks.md"]);
});

it("skips an invalid lesson and names it on stderr", () => {
  const ws = repo();
  save(ws, "plan-forks", lesson());
  fs.writeFileSync(path.join(ws, LESSONS_DIR, "old-shape.md"), "no frontmatter\n");
  const err = vi.spyOn(process.stderr, "write").mockReturnValue(true);
  expect(names(matchLessons({ files: ["src/a.ts"], workspaceRoot: ws }))).toStrictEqual(["plan-forks.md"]);
  expect(err).toHaveBeenCalledWith(".repo/lessons/old-shape.md: invalid, run bun repo lessons check\n");
  err.mockRestore();
});

// Windows cannot name a file with "|", and the glob must match one on disk.
it.skipIf(process.platform === "win32")("reads a glob that holds a pipe", () => {
  const ws = repo(["src/a|b.ts"]);
  save(ws, "pipes", lesson({ name: "pipes", paths: ["src/a|b.ts"] }));
  expect(matchLessons({ files: ["src/a|b.ts"], workspaceRoot: ws })).toMatchObject([{ paths: ["src/a|b.ts"] }]);
});

function twoCheckouts(rootHits: number, worktreeHits: number) {
  const ws = repo(["src/a.ts"]);
  git(ws, "init", "-q");
  save(ws, "shared", lesson({ hits: rootHits, name: "shared" }));
  git(ws, "add", "-A");
  git(ws, "commit", "-qm", "init");
  git(ws, "worktree", "add", "-q", ".worktrees/w", "-b", "wt/w");
  const w = path.join(ws, ".worktrees/w");
  save(w, "shared", lesson({ hits: worktreeHits, name: "shared" }));

  return { files: [path.join(ws, "src/a.ts"), path.join(w, "src/a.ts")], roots: resolveRoots({ workspaceRoot: ws }) };
}

it("keeps the row with more hits when two checkouts hold the same lesson", () => {
  for (const [rootHits, worktreeHits] of [
    [2, 5],
    [5, 2],
  ] as const) {
    const { roots, files } = twoCheckouts(rootHits, worktreeHits);
    expect(matchLessons({ files, roots }).map((r) => r.hits)).toStrictEqual([5]);
  }
});

it("ignores a file in a checkout whose lessons dir has no index", () => {
  const ws = repo(["src/a.ts"]);
  expect(
    matchLessons({ files: [path.join(ws, "src/a.ts")], roots: resolveRoots({ workspaceRoot: ws }) }),
  ).toStrictEqual([]);
});
