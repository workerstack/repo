import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { childEnv } from "../env.ts";
import { toolEnv } from "../scripts/lint.ts";

const dirs: string[] = [];

/** Removes every repo `tempDir` made; call it from an `afterEach`. */
export function removePlanted(): void {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
}

const env = toolEnv(childEnv());

/** Runs git in `cwd` with a committer identity and no signing. */
export const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", ...args], {
    cwd,
    env,
    encoding: "utf8",
  });

/** A new temp dir, removed by `removePlanted`. */
export function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "check-ratchets-"));
  dirs.push(dir);
  return dir;
}

/** Writes `files` (path → text, objects as JSON) under `dir`. */
export function write(dir: string, files: Record<string, unknown>): void {
  for (const [rel, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    const text = typeof content === "string" ? content : `${JSON.stringify(content, null, 2)}\n`;
    fs.writeFileSync(path.join(dir, rel), text);
  }
}

/** A repo whose `main` commit holds `files`, with a `feature` branch checked out. */
export function repoOnMain(files: Record<string, unknown>): string {
  const dir = tempDir();
  git(dir, "init", "-q", "-b", "main");
  write(dir, files);
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "main");
  git(dir, "checkout", "-q", "-b", "feature");
  return dir;
}
