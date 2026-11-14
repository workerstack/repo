// Temp workspaces for the gate suites, removed after each test, so no suite keeps its own cleanup list.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach } from "vitest";
import { removeTemps } from "../../__fixtures__/remove-temps.ts";

/** What `useTmp` hands a suite. Every dir is a real path, so a test compares in the product's spelling. */
export interface Tmp {
  /** An empty temp dir named from `prefix`. */
  dir: (prefix: string) => string;
  /** A temp dir that is a git repo with no commit. */
  repo: (prefix: string) => string;
  /** A temp git repo with one commit, ignoring `.tmp/` and `.worktrees/`, and a worktree `.worktrees/a`. */
  committed: (prefix: string) => string;
  /** A file of `bytes` zero bytes in a new temp dir. */
  file: (bytes: number, name: string) => string;
}

const IDENTITY = ["-c", "user.email=t@t", "-c", "user.name=t"];

/** Registers the cleanup in the calling suite; call it once at the top of a test file. */
export function useTmp(): Tmp {
  const made: string[] = [];
  afterEach(() => {
    removeTemps(made.splice(0).flatMap((d) => [d, `${d}-alias`]));
  });
  const dir = (prefix: string) => {
    const real = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
    made.push(real);
    return real;
  };
  const repo = (prefix: string) => {
    const r = dir(prefix);
    spawnSync("git", ["init", "-q"], { cwd: r });
    return r;
  };
  const committed = (prefix: string) => {
    const r = dir(prefix);
    const git = (...args: string[]) => spawnSync("git", [...IDENTITY, ...args], { cwd: r, encoding: "utf8" });
    git("init", "-q", "-b", "main");
    fs.writeFileSync(path.join(r, ".gitignore"), ".tmp/\n.worktrees/\n");
    git("add", "-A");
    git("commit", "-qm", "init");
    git("worktree", "add", "-q", "-b", "wt/a", path.join(r, ".worktrees", "a"));
    return r;
  };
  const file = (bytes: number, name: string) => {
    const target = path.join(dir("gate-fat-"), name);
    fs.writeFileSync(target, Buffer.alloc(bytes));
    return target;
  };
  return { dir, repo, committed, file };
}
