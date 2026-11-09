/** Planted checkouts and lesson texts for the lessons tests. */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { LESSONS_DIR, persistLesson } from "../lessons.ts";

const dirs: string[] = [];

/** Removes every dir made since the last call; each test file runs it after each test. */
export function cleanLessonDirs(): void {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
}

/** A temp dir (real path) holding `files`, removed by `cleanLessonDirs`. */
export function repo(files: string[] = ["src/a.ts", "src/deep/b.ts", "docs/x.md"]): string {
  const ws = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "lessons-kit-")));
  dirs.push(ws);
  for (const f of files) {
    fs.mkdirSync(path.dirname(path.join(ws, f)), { recursive: true });
    fs.writeFileSync(path.join(ws, f), "x\n");
  }
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
  summary = "Rewriting a saved plan minted a new serial.",
}: { name?: string; paths?: string[]; hits?: number; summary?: string } = {}): string {
  return `---
name: ${name}
paths: ${JSON.stringify(paths)}
hits: ${hits}
last-hit: 2026-10-31
evidence: ["plan 16"]
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
