import fs from "node:fs";
import path from "node:path";

import {
  BUSY_CODES,
  GONE_CODE,
  LEFT_CODE,
  OWNER_ALL,
  REMOVE_ATTEMPTS,
  REMOVE_DELAY_MS,
} from "./remove-tree.constants.ts";

/** Blocks the thread for `ms`; removal runs in sync cleanup code, so it cannot await a timer. */
function pause(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT)), 0, 0, ms);
}

/** Whether `target` is on disk; lstat, so a link whose target is gone still counts. */
function present(target: string): boolean {
  return fs.lstatSync(target, { throwIfNoEntry: false }) !== undefined;
}

/** Gives the owner every right on each dir in the tree at `target`, top down; whether any dir's mode changed. */
function unlock(target: string): boolean {
  const before = fs.lstatSync(target, { throwIfNoEntry: false });

  if (before?.isDirectory() !== true) return false;
  fs.chmodSync(target, before.mode | OWNER_ALL);
  let hasChanged = fs.lstatSync(target).mode !== before.mode;

  for (const name of fs.readdirSync(target)) hasChanged = unlock(path.join(target, name)) || hasChanged;

  return hasChanged;
}

/** Whether an rm error with `code` is worth another try while the target is still on disk. */
function retryable(code: string | undefined): boolean {
  return code === GONE_CODE || BUSY_CODES.includes(code ?? "");
}

/** One rm of `target`: nothing when it is gone after, else what failed, or an error naming what rm left. */
function attempt(target: string, rm: typeof fs.rmSync): NodeJS.ErrnoException | undefined {
  try {
    rm(target, { force: true, recursive: true });
  } catch (error) {
    return error /* rm throws fs errors that carry a code */ as NodeJS.ErrnoException;
  }

  if (!present(target)) return undefined;

  return Object.assign(new Error(`${LEFT_CODE}: rm returned but left ${target}`), { code: LEFT_CODE, path: target });
}

/**
 * Removes `target` and everything under it; a missing path is already done. After the first failed rm, when a dir in
 * the tree lacks an owner right, it gives the owner every right on the tree's dirs and tries again at once, since a
 * test killed before its cleanup can leave a dir it locked to test a refusal; rm reports that as EACCES on Linux and
 * ENOTEMPTY on macOS. A busy error, an entry that vanished mid-walk, or an rm that returns but leaves `target` is then
 * tried again, waiting longer each time, because Windows holds a file for a moment after the process that used it
 * exits. Gives up after `REMOVE_ATTEMPTS` calls and throws the last error unchanged, so its code and path reach the
 * caller.
 */
export function removeTree(
  target: string,
  rm: typeof fs.rmSync = fs.rmSync,
  sleep: (ms: number) => void = pause,
): void {
  let wasUnlockTried = false;
  let waits = 0;

  for (let calls = 1; present(target); calls++) {
    if (waits > 0) sleep(REMOVE_DELAY_MS * waits);
    const failure = attempt(target, rm);

    if (failure === undefined) return;
    const isFreed = !wasUnlockTried && unlock(target);
    wasUnlockTried = true;

    if (isFreed) continue;

    if (!retryable(failure.code) || calls >= REMOVE_ATTEMPTS) throw failure;
    waits += 1;
  }
}

/** `dir` and each parent of it that is not on disk yet, deepest first: what a recursive mkdir of `dir` would make. */
export function missingDirs(dir: string): string[] {
  const missing: string[] = [];

  for (let at = path.resolve(dir); !fs.existsSync(at); at = path.dirname(at)) missing.push(at);

  return missing;
}

/** Removes each of `dirs`, deepest first, while it is empty, so a run leaves none of the dirs it made behind. */
export function removeEmptyDirs(dirs: readonly string[]): void {
  for (const dir of dirs) {
    if (fs.readdirSync(dir).length > 0) return;
    fs.rmdirSync(dir);
  }
}
