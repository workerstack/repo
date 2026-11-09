#!/usr/bin/env bun
/**
 * This repo only: bun never links a root package's own bin or the package itself, so hooks, `bun repo`
 * and `@workerstack/repo/...` paths would find nothing here. Link `node_modules/.bin/repo` to
 * `bin/repo.ts` and `node_modules/@workerstack/repo` to the root, so this checkout has a consumer's layout.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { childEnv } from "../cli/env.ts";
import { toolEnv } from "../cli/scripts/lint.ts";
import { SYNC_ARGS, WINDOWS } from "./sync-args.constants.ts";

type Result = "linked" | "current";

const BIN_TARGET = path.join("..", "..", "bin", "repo.ts");
const PKG_TARGET = path.join("..", "..");

/** Make `link` a symlink to `target` (a junction to the absolute `abs` on win32), replacing anything else there. */
function ensureLink(link: string, target: string, abs: string, dir: boolean): Result {
  const win = process.platform === WINDOWS && dir;
  const want = win ? abs : target;
  let current: string | null = null;
  try {
    current = fs.readlinkSync(link);
  } catch {
    current = null;
  }
  if (current !== null && path.normalize(current) === path.normalize(want)) return "current";
  fs.mkdirSync(path.dirname(link), { recursive: true });
  fs.rmSync(link, { force: true, recursive: true });
  fs.symlinkSync(want, link, win ? "junction" : undefined);
  return "linked";
}

/** Link the bin and the package itself into `<root>/node_modules`. */
export function linkSelf(root: string): { bin: Result; pkg: Result } {
  const modules = path.join(root, "node_modules");
  return {
    bin: ensureLink(path.join(modules, ".bin", "repo"), BIN_TARGET, path.join(root, "bin", "repo.ts"), false),
    pkg: ensureLink(path.join(modules, "@workerstack", "repo"), PKG_TARGET, path.resolve(root), true),
  };
}

/** Runs `repo sync --postinstall` in `cwd` with the terminal inherited; returns its exit code. */
function runSync(cwd: string): number {
  const result = spawnSync(process.execPath, SYNC_ARGS, { cwd, env: toolEnv(childEnv()), stdio: "inherit" });
  return result.status ?? 1;
}

/** Link the bin and the package, then sync; returns the sync's exit code. */
export function linkAndSync(root: string, sync: (cwd: string) => number = runSync): number {
  linkSelf(root);
  return sync(root);
}

if (import.meta.main) process.exitCode = linkAndSync(process.cwd());
