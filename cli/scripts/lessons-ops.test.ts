import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { removeTree } from "../remove-tree.ts";
import { useTempDirs } from "../sync/__fixtures__/temp-dirs.ts";
import { indexText, lesson, repo, save } from "./__fixtures__/lessons-kit.ts";
import { checkLessons } from "./lessons-check.ts";
import { writeIndex } from "./lessons-index.ts";
import { hitLesson, matchLessons, persistLesson, removeLesson } from "./lessons-ops.ts";
import { LESSONS_DIR } from "./lessons.constants.ts";

useTempDirs();

function lessonText(ws: string, slug: string): string {
  return fs.readFileSync(path.join(ws, LESSONS_DIR, `${slug}.md`), "utf8");
}

describe("persistLesson", () => {
  it("writes the lesson, fills defaults, and regenerates the index", () => {
    const ws = repo();
    const bare = lesson().replace(/^hits: 1\nlast-hit: 2026-10-31\n/m, "");
    const r = save(ws, "plan-forks", bare);
    expect(r.ok, r.error).toBe(true);
    const text = lessonText(ws, "plan-forks");
    expect(text).toMatch(/^hits: 1$/m);
    expect(text).toMatch(/^last-hit: 2026-11-01$/m);
    expect(indexText(ws)).toContain("- `plan-forks` (hits 1): Plan rewrites fork serials");
  });

  it("denies an invalid lesson and writes nothing", () => {
    const ws = repo();
    const r = save(ws, "plan-forks", lesson({ paths: ["lib/**"] }));
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/matches no file/);
    expect(fs.existsSync(path.join(ws, LESSONS_DIR, "plan-forks.md"))).toBe(false);
  });

  it("denies a write to the generated index", () => {
    const ws = repo();
    const r = persistLesson({ content: "x", filePath: path.join(ws, LESSONS_DIR, "INDEX.md"), workspaceRoot: ws });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/generated/);
  });
});

it("matchLessons returns only matching rows, sorted by hits, capped", () => {
  const ws = repo();
  save(ws, "low", lesson({ name: "low", paths: ["src/**"] }));
  save(ws, "high", lesson({ hits: 3, name: "high", paths: ["src/*.ts"] }));
  save(ws, "docs-only", lesson({ hits: 9, name: "docs-only", paths: ["docs/**"] }));
  const rows = matchLessons({ files: [path.join(ws, "src/a.ts")], workspaceRoot: ws });
  expect(rows.map((r) => r.file)).toStrictEqual([".repo/lessons/high.md", ".repo/lessons/low.md"]);
  expect(rows[0]).toMatchObject({ hits: 3, paths: ["src/*.ts"], title: "Plan rewrites fork serials" });
  expect(matchLessons({ cap: 1, files: ["src/a.ts"], workspaceRoot: ws }).map((r) => r.file)).toStrictEqual([
    ".repo/lessons/high.md",
  ]);
  expect(matchLessons({ files: ["/elsewhere/src/a.ts"], workspaceRoot: ws })).toStrictEqual([]);
});

it("matchLessons returns nothing when there is no index", () => {
  expect(matchLessons({ files: ["src/a.ts"], workspaceRoot: repo() })).toStrictEqual([]);
});

it("hitLesson counts each new evidence once, keeps the 5 most recent, and updates the index", () => {
  const ws = repo();
  save(ws, "plan-forks", lesson({ evidence: [] }));

  for (const ev of ["plan 1", "plan 2"])
    expect(hitLesson({ evidence: ev, slug: "plan-forks", today: "2026-11-02", workspaceRoot: ws }).ok).toBe(true);

  expect(lessonText(ws, "plan-forks")).toMatch(/^hits: 3$/m);
  expect(lessonText(ws, "plan-forks")).toMatch(/^last-hit: 2026-11-02$/m);
  hitLesson({ evidence: "plan 2", slug: "plan-forks", today: "2026-11-03", workspaceRoot: ws });
  expect(lessonText(ws, "plan-forks")).toMatch(/^hits: 3$/m);

  for (const ev of ["plan 3", "plan 4", "plan 5", "plan 6"])
    hitLesson({ evidence: ev, slug: "plan-forks", today: "2026-11-03", workspaceRoot: ws });

  expect(lessonText(ws, "plan-forks")).toMatch(/^evidence: \["plan 2","plan 3","plan 4","plan 5","plan 6"\]$/m);
  expect(indexText(ws)).toContain("- `plan-forks` (hits 7)");
});

it("removeLesson removes the file and its row", () => {
  const ws = repo();
  save(ws, "plan-forks", lesson());
  expect(removeLesson({ slug: "plan-forks", workspaceRoot: ws }).ok).toBe(true);
  expect(fs.existsSync(path.join(ws, LESSONS_DIR, "plan-forks.md"))).toBe(false);
  expect(indexText(ws)).not.toContain("plan-forks");
  expect(removeLesson({ slug: "plan-forks", workspaceRoot: ws }).ok).toBe(false);
});

describe("writeIndex and checkLessons", () => {
  it("writes the same index on a rerun", () => {
    const ws = repo();
    save(ws, "plan-forks", lesson());
    const first = indexText(ws);
    writeIndex({ workspaceRoot: ws });
    expect(indexText(ws)).toBe(first);
  });

  it("reports index drift, an invalid file, and a stale glob", () => {
    const ws = repo();
    save(ws, "plan-forks", lesson());
    expect(checkLessons({ workspaceRoot: ws })).toStrictEqual([]);
    fs.chmodSync(path.join(ws, LESSONS_DIR, "INDEX.md"), 0o644);
    fs.writeFileSync(path.join(ws, LESSONS_DIR, "INDEX.md"), "stale\n");
    expect(checkLessons({ workspaceRoot: ws }).join("; ")).toMatch(/INDEX\.md is out of date/);
    writeIndex({ workspaceRoot: ws });
    fs.writeFileSync(path.join(ws, LESSONS_DIR, "broken.md"), "no frontmatter\n");
    removeTree(path.join(ws, "src"));
    const errors = checkLessons({ workspaceRoot: ws }).join("; ");
    expect(errors).toMatch(/broken\.md/);
    expect(errors).toMatch(/src\/\*\* matches no file/);
  });
});

it("checkLessons is clean when there is no lessons dir", () => {
  expect(checkLessons({ workspaceRoot: repo() })).toStrictEqual([]);
});

/** The index mode bits checked, and their value: 0444 on POSIX; win32 keeps only a read-only flag, so no write bit. */
const READ_ONLY = process.platform === "win32" ? { bits: 0o222, mode: 0 } : { bits: 0o777, mode: 0o444 };

function expectIndexReadOnly(ws: string): void {
  expect(fs.statSync(path.join(ws, LESSONS_DIR, "INDEX.md")).mode & READ_ONLY.bits).toBe(READ_ONLY.mode);
}

it("leaves a stamped, read-only index after a save and rewrites one that is already read-only", () => {
  const ws = repo();
  expect(save(ws, "plan-forks", lesson()).ok).toBe(true);
  expect(indexText(ws).split("\n")[0]).toBe("<!-- @generated by @workerstack/repo -->");
  expectIndexReadOnly(ws);
  expect(save(ws, "other-lesson", lesson({ name: "other-lesson" })).ok).toBe(true);
  expect(indexText(ws)).toContain("other-lesson");
  expect(indexText(ws).match(/@generated/g)).toHaveLength(1);
  expectIndexReadOnly(ws);
});

it("throws, naming the index, when it cannot write it", () => {
  const ws = repo();
  fs.mkdirSync(path.join(ws, LESSONS_DIR, "INDEX.md", "x"), { recursive: true });
  expect(() => writeIndex({ workspaceRoot: ws })).toThrow(/cannot write .*INDEX\.md: /);
});
