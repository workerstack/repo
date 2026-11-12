// A committed repo is a main checkout other sessions share: lesson saves, hits and removals happen in a worktree.
import fs from "node:fs";
import path from "node:path";

import { expect, it } from "vitest";

import { aliasOf } from "../../dev/test-paths";
import { tempDir, useTempDirs } from "../sync/__fixtures__/temp-dirs.ts";
import { committed, git, indexText, lesson, runLessons, save } from "./__fixtures__/lessons-kit.ts";
import { checkLessons } from "./lessons-check.ts";
import { writeIndex } from "./lessons-index.ts";
import { hitLesson, matchLessons, persistLesson, removeLesson } from "./lessons-ops.ts";
import { LESSONS_DIR } from "./lessons.constants.ts";
import { resolveRoots } from "./workspace-root.ts";

useTempDirs();

const REFUSAL = "the main checkout is shared: run bun repo worktree add <name>";

/** A failed result whose error holds the main-checkout refusal. */
function refused(): { error: string; ok: false } {
  return {
    error: expect.stringContaining(REFUSAL) /* a matcher, which toStrictEqual compares as the error text */ as string,
    ok: false,
  };
}

it("refuses to save, hit or remove a lesson in the main checkout and changes nothing", () => {
  const { ws } = committed();
  const before = fs.readFileSync(path.join(ws, LESSONS_DIR, "plan-forks.md"), "utf8");
  const index = indexText(ws);
  const file = path.join(ws, LESSONS_DIR, "other.md");
  const saved = persistLesson({ content: lesson({ name: "other" }), filePath: file, workspaceRoot: ws });
  expect(saved).toStrictEqual(refused());
  expect(hitLesson({ evidence: "plan 4", slug: "plan-forks", workspaceRoot: ws })).toStrictEqual(refused());
  expect(removeLesson({ slug: "plan-forks", workspaceRoot: ws })).toStrictEqual(refused());
  expect(fs.existsSync(file)).toBe(false);
  expect(fs.readFileSync(path.join(ws, LESSONS_DIR, "plan-forks.md"), "utf8")).toBe(before);
  expect(indexText(ws)).toBe(index);
});

it("refuses hit, rm and index on the command line from the main checkout with exit 1", () => {
  const { ws } = committed();

  for (const args of [["hit", "plan-forks", "--evidence", "plan 4"], ["rm", "plan-forks"], ["index"]]) {
    const r = runLessons(ws, ...args);
    expect(r.status, args.join(" ")).toBe(1);
    expect(r.stderr, args.join(" ")).toContain(REFUSAL);
  }

  expect(fs.existsSync(path.join(ws, LESSONS_DIR, "plan-forks.md"))).toBe(true);
  expect(runLessons(ws, "match", "src/a.ts").status).toBe(0);
  expect(runLessons(ws, "check").status).toBe(0);
});

it("saves, hits, removes and reindexes in a worktree", () => {
  const { ws, w } = committed();
  const r = save(w, "second", lesson({ name: "second", summary: "Second." }));
  expect(r.ok, r.error).toBe(true);
  expect(indexText(w)).toContain("second.md");
  expect(hitLesson({ evidence: "plan 4", slug: "second", today: "2026-11-02", workspaceRoot: w }).ok).toBe(true);
  const cli1 = runLessons(path.join(w, "src"), "hit", "plan-forks", "--evidence", "plan 5");
  expect(cli1.status, cli1.stderr).toBe(0);
  expect(runLessons(w, "rm", "second").status).toBe(0);
  expect(runLessons(w, "index").status).toBe(0);
  expect(indexText(w)).not.toContain("second.md");
  expect(fs.existsSync(path.join(ws, LESSONS_DIR, "second.md"))).toBe(false);
});

it("still reindexes and checks the main checkout for repo init", () => {
  const { ws } = committed();
  fs.chmodSync(path.join(ws, LESSONS_DIR, "INDEX.md"), 0o644);
  fs.writeFileSync(path.join(ws, LESSONS_DIR, "INDEX.md"), "stale\n");
  expect(checkLessons({ workspaceRoot: ws }).join("; ")).toMatch(
    /INDEX\.md is out of date; run bun repo lessons index inside a worktree/,
  );
  expect(writeIndex({ workspaceRoot: ws }).ok).toBe(true);
  expect(checkLessons({ workspaceRoot: ws })).toStrictEqual([]);
});

it("matches a file against the lessons of the checkout that holds it", () => {
  const { ws, w } = committed();
  // The worktree has its own lesson set; the root's lesson must not apply to its files.
  save(w, "worktree-only", lesson({ hits: 4, name: "worktree-only", paths: ["src/**"], summary: "Worktree." }));
  fs.rmSync(path.join(w, LESSONS_DIR, "plan-forks.md"));
  writeIndex({ workspaceRoot: w });
  const roots = resolveRoots({ workspaceRoot: ws });
  const inWorktree = matchLessons({ files: [path.join(w, "src/a.ts")], roots });
  expect(inWorktree.map((r) => r.file)).toStrictEqual([".repo/lessons/worktree-only.md"]);
  const inRoot = matchLessons({ files: [path.join(ws, "src/a.ts")], roots });
  expect(inRoot.map((r) => r.file)).toStrictEqual([".repo/lessons/plan-forks.md"]);
  const both = matchLessons({ files: [path.join(ws, "src/a.ts"), path.join(aliasOf(w), "src/a.ts")], roots });
  expect(both.map((r) => r.file)).toStrictEqual([".repo/lessons/worktree-only.md", ".repo/lessons/plan-forks.md"]);
});

it("falls back to the caller's checkout for an unmanaged linked worktree outside the root", () => {
  const { ws } = committed();
  const outside = path.join(fs.realpathSync(tempDir("lessons-linked-")), "linked");
  git(ws, "worktree", "add", "-q", outside, "-b", "linked");
  const roots = resolveRoots({ cwd: outside });
  expect(roots.checkout).toBe(outside);
  expect(roots.root).toBe(ws);
  const rows = matchLessons({ files: [path.join(outside, "src/a.ts")], roots });
  expect(rows.map((r) => r.file)).toStrictEqual([".repo/lessons/plan-forks.md"]);
  // A write there is not the main checkout, so it saves.
  const r = save(outside, "linked-one", lesson({ name: "linked-one" }));
  expect(r.ok, r.error).toBe(true);
});
