import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readEnv } from "../cli/env.ts";
import { PERMISSION_DENIED, ROOT_PREFIX } from "./temp-root.constants.ts";

/**
 * Vitest globalSetup: every run gets its own temp root, so a test that leaves a dir behind fails the run and a
 * crashed run's root is removed by the next one. Workers inherit TMPDIR, TEMP and TMP, so `os.tmpdir()` is the root.
 */
const TEMP_VARIABLES = ["TMPDIR", "TEMP", "TMP"] as const;
const FAILED = 1;

/** `repo-test-<pid>-<suffix>` names give the pid; anything else is not ours. */
function pidOf(name: string): number | undefined {
  const match = /^repo-test-(\d+)-/.exec(name);
  return match?.[1] === undefined ? undefined : Number(match[1]);
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM: the pid exists but belongs to someone else.
    return error instanceof Error && "code" in error && error.code === PERMISSION_DENIED;
  }
}

/** Removes the roots whose run is gone; a second call finds nothing and does nothing. */
function removeDeadRoots(base: string): void {
  for (const name of fs.readdirSync(base)) {
    const pid = pidOf(name);
    if (pid !== undefined && !isAlive(pid)) fs.rmSync(path.join(base, name), { recursive: true, force: true });
  }
}

export function leakMessage(names: string[]): string {
  const list = names.sort().join(", ");
  return `tests left ${names.length} entries in the run's temp root: ${list}; remove each in the test that made it`;
}

/** Ends the run: keeps the root when asked, otherwise removes it and fails when it was not empty. */
function finish(root: string): void {
  if (readEnv().REPO_E2E_KEEP) {
    process.stdout.write(`kept temp root: ${root}\n`);
    return;
  }
  const left = fs.readdirSync(root);
  fs.rmSync(root, { recursive: true, force: true });
  if (left.length === 0) return;
  process.exitCode = FAILED;
  process.stderr.write(`Error: ${leakMessage(left)}\n`);
}

export function setup(): () => void {
  const base = fs.realpathSync(os.tmpdir());
  removeDeadRoots(base);
  const root = fs.mkdtempSync(path.join(base, `${ROOT_PREFIX}${process.pid}-`));
  for (const name of TEMP_VARIABLES) process.env[name] = root;
  // Node's compile cache defaults to <tmpdir>/node-compile-cache; vitest run by a spawned tool would put it in the root.
  process.env.NODE_COMPILE_CACHE ??= path.join(base, "node-compile-cache");
  return () => finish(root);
}
