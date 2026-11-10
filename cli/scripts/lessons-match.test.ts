import fs from "node:fs";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { cleanLessonDirs, git, lesson, repo, save } from "./fixtures/lessons-kit.ts";
import { LESSONS_DIR, matchLessons } from "./lessons.ts";
import { resolveRoots } from "./workspace-root.ts";

afterEach(cleanLessonDirs);

const names = (rows: { file: string }[]) => rows.map((r) => path.basename(r.file));

it("breaks a tie of hits by file name", () => {
  const ws = repo();
  save(ws, "b-one", lesson({ name: "b-one" }));
  save(ws, "a-one", lesson({ name: "a-one" }));
  expect(names(matchLessons({ workspaceRoot: ws, files: ["src/a.ts"] }))).toEqual(["a-one.md", "b-one.md"]);
});

it("skips an index row that does not have five cells", () => {
  const ws = repo();
  save(ws, "plan-forks", lesson());
  const index = path.join(ws, LESSONS_DIR, "INDEX.md");
  fs.appendFileSync(index, "| .repo/lessons/short.md | src/** | 3 |\n");
  expect(names(matchLessons({ workspaceRoot: ws, files: ["src/a.ts"] }))).toEqual(["plan-forks.md"]);
});

// Windows cannot name a file with "|", and the glob must match one on disk.
it.skipIf(process.platform === "win32")("reads a summary and glob that hold an escaped pipe", () => {
  const ws = repo(["src/a|b.ts"]);
  save(ws, "pipes", lesson({ name: "pipes", paths: ["src/a|b.ts"], summary: "Left | right." }));
  const rows = matchLessons({ workspaceRoot: ws, files: ["src/a|b.ts"] });
  expect(rows).toMatchObject([{ paths: ["src/a|b.ts"], summary: "Left | right." }]);
});

function twoCheckouts(rootHits: number, worktreeHits: number) {
  const ws = repo(["src/a.ts"]);
  git(ws, "init", "-q");
  save(ws, "shared", lesson({ name: "shared", hits: rootHits }));
  git(ws, "add", "-A");
  git(ws, "commit", "-qm", "init");
  git(ws, "worktree", "add", "-q", ".worktrees/w", "-b", "wt/w");
  const w = path.join(ws, ".worktrees/w");
  save(w, "shared", lesson({ name: "shared", hits: worktreeHits }));
  return { roots: resolveRoots({ workspaceRoot: ws }), files: [path.join(ws, "src/a.ts"), path.join(w, "src/a.ts")] };
}

it("keeps the row with more hits when two checkouts hold the same lesson", () => {
  for (const [rootHits, worktreeHits] of [
    [2, 5],
    [5, 2],
  ] as const) {
    const { roots, files } = twoCheckouts(rootHits, worktreeHits);
    expect(matchLessons({ roots, files }).map((r) => r.hits)).toEqual([5]);
  }
});

it("ignores a file in a checkout whose lessons dir has no index", () => {
  const ws = repo(["src/a.ts"]);
  expect(matchLessons({ roots: resolveRoots({ workspaceRoot: ws }), files: [path.join(ws, "src/a.ts")] })).toEqual([]);
});
