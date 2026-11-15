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

/** rm on `target` until it is gone, trying a busy, vanished or left tree again, waiting longer each time. */
function removeRetrying(target: string, rm: typeof fs.rmSync, sleep: (ms: number) => void): void {
  let last: unknown;

  for (let attempt = 1; ; attempt++) {
    if (!present(target)) return;

    if (attempt > REMOVE_ATTEMPTS) throw last;

    if (attempt > 1) sleep(REMOVE_DELAY_MS * (attempt - 1));

    try {
      rm(target, { force: true, recursive: true });
      last = Object.assign(new Error(`${LEFT_CODE}: rm returned but left ${target}`), {
        code: LEFT_CODE,
        path: target,
      });
    } catch (error) {
      const { code } = error /* rm throws fs errors that carry a code */ as NodeJS.ErrnoException;

      if (!retryable(code)) throw error;

      last = error;
    }
  }
}

/**
 * Removes `target` and everything under it; a missing path is already done. A busy error, an entry that vanished
 * mid-walk, or an rm that returns but leaves `target` is tried again, waiting longer each time, because Windows
 * holds a file for a moment after the process that used it exits. When that fails and a dir in the tree lacks an owner
 * right, it gives the owner every right on the tree's dirs and tries once more, since a test killed before its cleanup
 * can leave a dir it locked to test a refusal; rm reports that as EACCES on Linux and ENOTEMPTY on macOS.
 * Gives up after `REMOVE_ATTEMPTS` calls and throws the last error unchanged, so its code and path reach the caller.
 */
export function removeTree(
  target: string,
  rm: typeof fs.rmSync = fs.rmSync,
  sleep: (ms: number) => void = pause,
): void {
  try {
    removeRetrying(target, rm, sleep);
  } catch (error) {
    if (!unlock(target)) throw error;
    removeRetrying(target, rm, sleep);
  }
}
