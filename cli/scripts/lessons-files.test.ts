import fs from "node:fs";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { cleanLessonDirs, git, indexText, lesson, repo, save } from "./fixtures/lessons-kit.ts";
import {
  LESSONS_DIR,
  checkLessons,
  hitLesson,
  lessonProblems,
  persistLesson,
  removeLesson,
  renderLessonsIndex,
  repoFiles,
  validateLesson,
  writeIndex,
} from "./lessons.ts";

afterEach(cleanLessonDirs);

const dir = (ws: string) => path.join(ws, LESSONS_DIR);
const TOOLING = ["node", "modules"].join("_");

it("lists the files of a directory git does not track, skipping tooling dirs and links", () => {
  const ws = repo(["src/a.ts", `${TOOLING}/x/y.js`, ".git/config", ".tmp/z.txt"]);
  fs.symlinkSync(path.join(ws, "src/a.ts"), path.join(ws, "link.ts"));
  expect(repoFiles(ws).sort()).toEqual(["src/a.ts"]);
});

it("lists tracked and untracked files of a git checkout", () => {
  const ws = repo(["src/a.ts"]);
  git(ws, "init", "-q");
  expect(repoFiles(ws)).toEqual(["src/a.ts"]);
});

it("validates a lesson text without a file list", () => {
  expect(validateLesson("plan-forks.md", lesson({ paths: ["nowhere/**"] }))).toEqual([]);
});

it("renders an empty index and reports no problems for a checkout without lessons", () => {
  const ws = repo();
  expect(renderLessonsIndex(ws)).toContain("| lesson | paths | hits | last-hit | summary |");
  expect(lessonProblems(ws)).toEqual([]);
});

it("skips a lesson file that does not parse when it indexes", () => {
  const ws = repo();
  save(ws, "plan-forks", lesson());
  fs.writeFileSync(path.join(dir(ws), "broken.md"), "no frontmatter\n");
  writeIndex({ workspaceRoot: ws });
  expect(indexText(ws)).not.toContain("broken.md");
});

it("sorts rows of equal hits by file name", () => {
  const ws = repo();
  save(ws, "b-one", lesson({ name: "b-one" }));
  save(ws, "a-one", lesson({ name: "a-one" }));
  const rows = indexText(ws)
    .split("\n")
    .filter((l) => l.startsWith("| .repo"));
  expect(rows.map((l) => l.split(" | ")[0])).toEqual(["| .repo/lessons/a-one.md", "| .repo/lessons/b-one.md"]);
});

it("denies a lesson file whose name is not a slug or not markdown", () => {
  const ws = repo();
  const bad = persistLesson({ workspaceRoot: ws, filePath: path.join(dir(ws), "Bad_Name.md"), content: lesson() });
  expect(bad).toEqual({ ok: false, error: "lesson filename must be a lowercase-hyphen slug: Bad_Name.md" });
  const txt = persistLesson({ workspaceRoot: ws, filePath: path.join(dir(ws), "plan.txt"), content: lesson() });
  expect(txt.ok).toBe(false);
  const elsewhere = persistLesson({ workspaceRoot: ws, filePath: path.join(ws, "plan-forks.md"), content: lesson() });
  expect(elsewhere.error).toMatch(/write lessons as \.repo\/lessons\/\{slug\}\.md/);
});

it("denies a lesson that does not parse and names why", () => {
  const ws = repo();
  const r = persistLesson({ workspaceRoot: ws, filePath: path.join(dir(ws), "plan-forks.md"), content: "plain\n" });
  expect(r.error).toMatch(/start with --- frontmatter/);
});

it("refuses a hit on a missing lesson and on one that no longer parses", () => {
  const ws = repo();
  expect(hitLesson({ workspaceRoot: ws, slug: "ghost", evidence: "e" }).error).toBe(
    "no lesson ghost; write .repo/lessons/ghost.md first",
  );
  save(ws, "plan-forks", lesson());
  fs.writeFileSync(path.join(dir(ws), "plan-forks.md"), "broken\n");
  expect(hitLesson({ workspaceRoot: ws, slug: "plan-forks", evidence: "e" }).error).toMatch(/start with ---/);
});

it("refuses to remove a lesson that is not there", () => {
  expect(removeLesson({ workspaceRoot: repo(), slug: "ghost" })).toEqual({ ok: false, error: "no lesson ghost" });
});

it("flags a lessons dir whose index file is missing", () => {
  const ws = repo();
  save(ws, "plan-forks", lesson());
  fs.rmSync(path.join(dir(ws), "INDEX.md"));
  expect(checkLessons({ workspaceRoot: ws }).join(";")).toMatch(/INDEX\.md is out of date/);
});
