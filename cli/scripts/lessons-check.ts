/** `repo lessons check`: every lesson file valid and the index current. */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { validateLesson } from "./lesson-file.ts";
import { lessonFiles, lessonsDir, renderLessonsIndex } from "./lessons-index.ts";
import { INDEX_NAME, LESSONS_DIR, SKIP_WALK } from "./lessons.constants.ts";

/** `p` with `/` separators. */
export function toPosix(p: string): string {
  return p.split(path.sep).join("/");
}

function walkFiles(ws: string, dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((ent): string[] => {
    const abs = path.join(dir, ent.name);

    if (SKIP_WALK.has(ent.name) || SKIP_WALK.has(toPosix(path.relative(ws, abs)))) return [];

    if (ent.isDirectory()) return walkFiles(ws, abs);

    return ent.isFile() ? [toPosix(path.relative(ws, abs))] : [];
  });
}

/** Repo-relative files: tracked and untracked-but-not-ignored in git, else a walk. */
export function repoFiles(ws: string): string[] {
  const git = spawnSync("git", ["ls-files", "-co", "--exclude-standard"], { cwd: ws, encoding: "utf8" });

  if (git.status === 0) return git.stdout.split("\n").filter(Boolean);

  return walkFiles(ws, ws);
}

/** One error per lesson file that breaks the format or whose `paths` match no file; empty without a lessons dir. */
export function lessonProblems(ws: string): string[] {
  const dir = lessonsDir(ws);

  if (!fs.existsSync(dir)) return [];
  const files = repoFiles(ws);

  return lessonFiles(ws).flatMap((name) =>
    validateLesson(name, fs.readFileSync(path.join(dir, name), "utf8"), { files }).map(
      (e) => `${LESSONS_DIR}/${name}: ${e}`,
    ),
  );
}

function readOrNull(file: string): string | null {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

/** The lesson problems, and a line when the index on disk is not what the lesson files render. */
export function checkLessons({ workspaceRoot: ws }: { workspaceRoot: string }): string[] {
  const dir = lessonsDir(ws);

  if (!fs.existsSync(dir)) return [];
  const errors = lessonProblems(ws);

  if (readOrNull(path.join(dir, INDEX_NAME)) !== renderLessonsIndex(ws))
    errors.push(`${LESSONS_DIR}/${INDEX_NAME} is out of date; run bun repo lessons index inside a worktree`);

  return errors;
}
