import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const temps: string[] = [];

/** Removes every dir `tempDir` made; call it from an `afterEach`. */
export function removeTemps(): void {
  for (const dir of temps.splice(0)) fs.rmSync(dir, { force: true, recursive: true });
}

/** A new temp dir with symlinks resolved, removed by `removeTemps`. */
export function tempDir(): string {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "commit-msg-")));
  temps.push(dir);
  return dir;
}

/** Runs git in `cwd` with a committer identity; its stdout. */
export function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", ["-c", "user.email=a@b", "-c", "user.name=a", ...args], { cwd, encoding: "utf8" });
}

/** `n` numbered lines, one change each. */
export function lines(n: number): string {
  return Array.from({ length: n }, (_, i) => `line ${i}\n`).join("");
}

/** Writes `files` (path → content) under `root`, making their folders. */
export function put(root: string, files: Record<string, string | Buffer>): void {
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), text);
  }
}
