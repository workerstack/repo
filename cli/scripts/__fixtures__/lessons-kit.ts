/** Planted checkouts and lesson texts for the lessons tests. */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { bunPath } from "../../../dev/test-paths";
import { tempDir } from "../../sync/__fixtures__/temp-dirs.ts";
import { LESSONS_DIR } from "../lessons.constants.ts";
import { persistLesson } from "../lessons-ops.ts";

/**
 * A checkout (real path) holding `files`, in a temp dir `useTempDirs` removes; the dir also holds the
 * `${ws}-alias` link `aliasOf` makes beside it.
 */
export function repo(files: string[] = ["src/a.ts", "src/deep/b.ts", "docs/x.md"]): string {
  const ws = path.join(fs.realpathSync(tempDir("lessons-kit-")), "ws");
  for (const f of files) {
    fs.mkdirSync(path.dirname(path.join(ws, f)), { recursive: true });
    fs.writeFileSync(path.join(ws, f), "x\n");
  }
  fs.mkdirSync(ws, { recursive: true });
  return ws;
}

export function git(cwd: string, ...args: string[]): void {
  spawnSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", ...args], { cwd, encoding: "utf8" });
}

/** A well-formed lesson text. */
export function lesson({
  name = "plan-forks",
  paths = ["src/**"],
  hits = 1,
  evidence = ["plan 16"],
  summary = "Rewriting a saved plan minted a new serial.",
}: { name?: string; paths?: string[]; hits?: number; evidence?: string[]; summary?: string } = {}): string {
  return `---
name: ${name}
paths: ${JSON.stringify(paths)}
hits: ${hits}
last-hit: 2026-10-31
evidence: ${JSON.stringify(evidence)}
---

# Plan rewrites fork serials

${summary}

## Mistake
A full-body Write to a saved plan went through the create path.

## Fix
Update the saved file in place and keep its serial.
`;
}

/** The host side of a lesson Write: persist, then write what it returned. */
export function save(ws: string, slug: string, text: string) {
  const file = path.join(ws, LESSONS_DIR, `${slug}.md`);
  const r = persistLesson({ workspaceRoot: ws, filePath: file, content: text, today: "2026-11-01" });
  if (r.ok) fs.writeFileSync(file, r.content);
  return r;
}

export const indexText = (ws: string): string => fs.readFileSync(path.join(ws, LESSONS_DIR, "INDEX.md"), "utf8");

/** A committed checkout holding `plan-forks`, and its managed worktree `w` on branch `wt/w`. */
export function committed(): { w: string; ws: string } {
  const ws = repo();
  git(ws, "init", "-q");
  save(ws, "plan-forks", lesson());
  git(ws, "add", "-A");
  git(ws, "commit", "-qm", "init");
  git(ws, "worktree", "add", "-q", ".worktrees/w", "-b", "wt/w");
  return { w: path.join(ws, ".worktrees/w"), ws };
}

const CLI = fileURLToPath(new URL("../../../bin/repo.ts", import.meta.url));

/** `bun repo lessons <args>` run from `cwd`. */
export function runLessons(cwd: string, ...args: string[]) {
  return spawnSync(bunPath(), [CLI, "lessons", ...args], { cwd, encoding: "utf8" });
}
