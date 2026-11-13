import fs from "node:fs";
import path from "node:path";

import { expect, it } from "vitest";

import { useTempDirs } from "../sync/__fixtures__/temp-dirs.ts";
import { git, indexText, lesson, repo, save } from "./__fixtures__/lessons-kit.ts";
import { validateLesson } from "./lesson-file.ts";
import { checkLessons, lessonProblems, repoFiles } from "./lessons-check.ts";
import { renderLessonsIndex, writeIndex } from "./lessons-index.ts";
import { hitLesson, persistLesson, removeLesson } from "./lessons-ops.ts";
import { LESSONS_DIR } from "./lessons.constants.ts";

useTempDirs();

function dir(ws: string) {
  return path.join(ws, LESSONS_DIR);
}

const TOOLING = ["node", "modules"].join("_");

it("lists the files of a directory git does not track, skipping tooling dirs and links", () => {
  const ws = repo(["src/a.ts", `${TOOLING}/x/y.js`, ".git/config", ".tmp/z.txt"]);
  fs.symlinkSync(path.join(ws, "src/a.ts"), path.join(ws, "link.ts"));
  expect(repoFiles(ws)).toStrictEqual(["src/a.ts"]);
});

it("skips .repo/scratch and .repo/tmp when it walks, but not .repo/lessons", () => {
  const ws = repo([".repo/scratch/a.md", ".repo/tmp/b.md", ".repo/lessons/c.md", "src/a.ts"]);
  expect(repoFiles(ws).toSorted()).toStrictEqual([".repo/lessons/c.md", "src/a.ts"]);
});

it("lists tracked and untracked files of a git checkout", () => {
  const ws = repo(["src/a.ts"]);
  git(ws, "init", "-q");
  expect(repoFiles(ws)).toStrictEqual(["src/a.ts"]);
});

it("validates a lesson text without a file list", () => {
  expect(validateLesson("plan-forks.md", lesson({ paths: ["nowhere/**"] }))).toStrictEqual([]);
});

it("renders an empty index and reports no problems for a checkout without lessons", () => {
  const ws = repo();
  expect(renderLessonsIndex(ws)).toContain("\n# Lessons\n");
  expect(lessonProblems(ws)).toStrictEqual([]);
});

it("skips a lesson file that does not parse when it indexes", () => {
  const ws = repo();
  save(ws, "plan-forks", lesson());
  fs.writeFileSync(path.join(dir(ws), "broken.md"), "no frontmatter\n");
  writeIndex({ workspaceRoot: ws });
  expect(indexText(ws)).not.toContain("broken.md");
});

it("lists one line per lesson, most hits first, then by file name", () => {
  const ws = repo();
  save(ws, "b-one", lesson({ name: "b-one" }));
  save(ws, "a-one", lesson({ name: "a-one" }));
  save(ws, "top", lesson({ hits: 6, name: "top" }));

  expect(
    indexText(ws)
      .split("\n")
      .filter((l) => l.startsWith("- ")),
  ).toStrictEqual([
    "- `top` (hits 6): Plan rewrites fork serials",
    "- `a-one` (hits 1): Plan rewrites fork serials",
    "- `b-one` (hits 1): Plan rewrites fork serials",
  ]);
  expect(indexText(ws)).toContain("\n# Lessons\n\n- `top`");
});

const BIG = "x".repeat(400);

const BODY_HEAD = /# Plan[\s\S]*$/;

/** The kit lesson with its body replaced; `mid` is a line left between the title and `## Mistake`. */
function withBody({ title, mistake, fix, mid = "" }: { title: string; mistake: string; fix: string; mid?: string }) {
  return lesson().replace(BODY_HEAD, `# ${title}\n\n${mid}## Mistake\n${mistake}\n\n## Fix\n${fix}\n`);
}

function errorsOf(text: string): string {
  return validateLesson("plan-forks.md", text).join("; ");
}

it("refuses a title, Mistake or Fix over its cap, and a line under the title", () => {
  const ok = { fix: "f", mistake: "m", title: "t" };

  expect(errorsOf(withBody({ ...ok, title: "t".repeat(73) }))).toBe(
    "title is 73 chars; the cap is 72, so state the rule shorter",
  );

  expect(errorsOf(withBody({ ...ok, mistake: BIG.slice(0, 281) }))).toBe(
    "## Mistake is 281 chars; the cap is 280, so keep only what went wrong",
  );

  expect(errorsOf(withBody({ ...ok, fix: BIG.slice(0, 361) }))).toBe(
    "## Fix is 361 chars; the cap is 360, so keep only what to do",
  );

  expect(errorsOf(withBody({ ...ok, mid: "A summary.\n\n" }))).toBe(
    "drop the line under the # title; put its point in the title or ## Mistake",
  );
});

it("accepts a title, Mistake and Fix exactly at their caps", () => {
  const text = withBody({ fix: BIG.slice(0, 360), mistake: BIG.slice(0, 280), title: "t".repeat(72) });

  expect(errorsOf(text)).toBe("");
});

it("denies a lesson file whose name is not a slug or not markdown", () => {
  const ws = repo();
  const bad = persistLesson({ content: lesson(), filePath: path.join(dir(ws), "Bad_Name.md"), workspaceRoot: ws });
  expect(bad).toStrictEqual({ error: "lesson filename must be a lowercase-hyphen slug: Bad_Name.md", ok: false });
  const txt = persistLesson({ content: lesson(), filePath: path.join(dir(ws), "plan.txt"), workspaceRoot: ws });
  expect(txt.ok).toBe(false);
  const elsewhere = persistLesson({ content: lesson(), filePath: path.join(ws, "plan-forks.md"), workspaceRoot: ws });
  expect(elsewhere.error).toMatch(/write lessons as \.repo\/lessons\/\{slug\}\.md/);
});

it("denies a lesson that does not parse and names why", () => {
  const ws = repo();
  const r = persistLesson({ content: "plain\n", filePath: path.join(dir(ws), "plan-forks.md"), workspaceRoot: ws });
  expect(r.error).toMatch(/start with --- frontmatter/);
});

it("refuses a hit on a missing lesson and on one that no longer parses", () => {
  const ws = repo();
  expect(hitLesson({ evidence: "e", slug: "ghost", workspaceRoot: ws }).error).toBe(
    "no lesson ghost; write .repo/lessons/ghost.md first",
  );
  save(ws, "plan-forks", lesson());
  fs.writeFileSync(path.join(dir(ws), "plan-forks.md"), "broken\n");
  expect(hitLesson({ evidence: "e", slug: "plan-forks", workspaceRoot: ws }).error).toMatch(/start with ---/);
});

it("refuses to remove a lesson that is not there", () => {
  expect(removeLesson({ slug: "ghost", workspaceRoot: repo() })).toStrictEqual({ error: "no lesson ghost", ok: false });
});

it("flags a lessons dir whose index file is missing", () => {
  const ws = repo();
  save(ws, "plan-forks", lesson());
  fs.rmSync(path.join(dir(ws), "INDEX.md"));
  expect(checkLessons({ workspaceRoot: ws }).join(";")).toMatch(/INDEX\.md is out of date/);
});
