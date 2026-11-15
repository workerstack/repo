import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { CONFIG_FILE } from "../config.constants.ts";
import { removeTemps as removeEach } from "./remove-temps.ts";

const temps: string[] = [];

/** Removes every dir `tempDir` made; call it from an `afterEach`. */
export function removeTemps(): void {
  removeEach(temps.splice(0));
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

/**
 * A repo whose base commit holds `config` as repo.config.ts and a private package.json; `commit` adds files and
 * commits with `message`, returning the sha.
 */
export function plant(config = "export default {}\n") {
  const root = tempDir();
  git(root, "init", "-q", "-b", "main");

  function commit(files: Record<string, string | Buffer>, message: string) {
    put(root, files);
    git(root, "add", "-A");
    git(root, "commit", "-q", "--no-verify", "-m", message);

    return git(root, "rev-parse", "HEAD").trim();
  }

  const base = commit(
    { [CONFIG_FILE]: config, "package.json": JSON.stringify({ name: "app", private: true }) },
    "chore: base",
  );

  return { base, commit, root };
}
