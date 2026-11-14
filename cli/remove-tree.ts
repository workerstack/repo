import fs from "node:fs";

import { BUSY_CODES, GONE_CODE, LEFT_CODE, REMOVE_ATTEMPTS, REMOVE_DELAY_MS } from "./remove-tree.constants.ts";

/** Blocks the thread for `ms`; removal runs in sync cleanup code, so it cannot await a timer. */
function pause(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT)), 0, 0, ms);
}

/** Whether `target` is on disk; lstat, so a link whose target is gone still counts. */
function present(target: string): boolean {
  return fs.lstatSync(target, { throwIfNoEntry: false }) !== undefined;
}

/** Whether an rm error with `code` is worth another try while the target is still on disk. */
function retryable(code: string | undefined): boolean {
  return code === GONE_CODE || BUSY_CODES.includes(code ?? "");
}

/**
 * Removes `target` and everything under it; a missing path is already done. A busy error, an entry that vanished
 * mid-walk, or an rm that returns but leaves `target` is tried again, waiting longer each time, because Windows
 * holds a file for a moment after the process that used it exits. Gives up after `REMOVE_ATTEMPTS` calls and throws
 * the last error unchanged, so its code and path reach the caller.
 */
export function removeTree(
  target: string,
  rm: typeof fs.rmSync = fs.rmSync,
  sleep: (ms: number) => void = pause,
): void {
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
