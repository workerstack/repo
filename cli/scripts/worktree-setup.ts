import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { z } from "zod";

import { tryJson } from "../json.ts";
import { branchExists, git } from "./worktree-git.ts";
import {
  BIN_DIR,
  INSTALL_TIMEOUT_MS,
  LOCKFILES,
  STDERR_FD,
  SYNC_TIMEOUT_MS,
  WORKTREES_DIR,
} from "./worktree.constants.ts";

/** Copy each gitignored file `.worktreeinclude` matches that the worktree lacks; never overwrite. */
export function copyIncluded(root: string, dest: string): void {
  if (!fs.existsSync(path.join(root, ".worktreeinclude"))) return;
  const listed = git(root, ["ls-files", "--others", "--ignored", "--exclude-from=.worktreeinclude"]);
  const candidates = listed.out.split("\n").filter((rel) => rel !== "" && !rel.startsWith(`${WORKTREES_DIR}/`));

  if (candidates.length === 0) return;

  const ignored = spawnSync("git", ["check-ignore", "--stdin"], {
    cwd: root,
    encoding: "utf8",
    input: candidates.join("\n"),
  });

  for (const rel of ignored.stdout.split("\n").filter(Boolean)) {
    const to = path.join(dest, rel);

    if (fs.existsSync(to)) continue;
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(path.join(root, rel), to);
  }
}

export function createWorktree(root: string, dest: string, branch: string): void {
  if (fs.existsSync(dest))
    throw new Error(`${dest} exists and is not a worktree of this repo; move it or pick another name`);

  const args = branchExists(root, branch)
    ? ["worktree", "add", dest, branch]
    : ["worktree", "add", "-b", branch, dest, "HEAD"];

  // git's own output goes to stderr, so stdout carries only the path.
  if (spawnSync("git", args, { cwd: root, stdio: ["ignore", STDERR_FD, STDERR_FD] }).status !== 0)
    throw new Error(`git worktree add failed for ${dest}`);
}

/**
 * A new worktree has no `node_modules`, so tools that look up `<cwd>/node_modules/.bin` fail there.
 * Install from the root's lockfile; the install's output goes to stderr and a failure only warns.
 */
export function installDependencies(root: string, dest: string): void {
  if (!LOCKFILES.some((f) => fs.existsSync(path.join(root, f)))) return;

  const r = spawnSync("bun", ["install", "--frozen-lockfile"], {
    cwd: dest,
    stdio: ["ignore", STDERR_FD, STDERR_FD],
    timeout: INSTALL_TIMEOUT_MS,
  });

  if (r.status !== 0)
    process.stderr.write(`could not install dependencies in ${dest}: run bun install --frozen-lockfile there\n`);
}

/**
 * True when `bun repo` can run in `root`: a `repo` script in its package.json, or a `repo` bin in its bin dir, the
 * places `.githooks/pre-push` looks.
 */
function canRunRepo(root: string): boolean {
  const bins = ["repo", "repo.exe"].map((b) => path.join(root, BIN_DIR, b));

  if (bins.some((b) => fs.existsSync(b))) return true;
  const manifest = path.join(root, "package.json");
  const withRepoScript = z.looseObject({ scripts: z.looseObject({ repo: z.string() }) });

  return fs.existsSync(manifest) && tryJson(withRepoScript, fs.readFileSync(manifest, "utf8")) !== undefined;
}

/**
 * After the root's files moved, its generated configs are stale: run `bun repo sync` there, output to stderr. Skipped
 * when `bun repo` cannot run in the root; a failure only warns.
 */
export function syncRoot(root: string): void {
  if (!canRunRepo(root)) return;

  const r = spawnSync("bun", ["repo", "sync"], {
    cwd: root,
    stdio: ["ignore", STDERR_FD, STDERR_FD],
    timeout: SYNC_TIMEOUT_MS,
  });

  if (r.status !== 0) process.stderr.write(`could not sync ${root}: run bun repo sync there\n`);
}
