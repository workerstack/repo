/** A cross-process lock on the jev ledger: a directory only one process can create. */
import fs from "node:fs";
import path from "node:path";

import { isRecord } from "../json.ts";
import { EEXIST, INT32_BYTES, LOCK_POLL_MS, LOCK_STALE_MS, SECRET_DIR_MODE } from "./jev.constants.ts";

function isErrno(err: unknown, code: string): boolean {
  return isRecord(err) && err.code === code;
}

/** True when the lock was taken; false when another process holds it. */
function tryTake(lock: string): boolean {
  try {
    fs.mkdirSync(lock);

    return true;
  } catch (err) {
    if (!isErrno(err, EEXIST)) throw err;

    return false;
  }
}

/** A lock older than the stale window, or one gone since the take failed. */
function isStale(lock: string): boolean {
  try {
    return Date.now() - fs.statSync(lock).mtimeMs > LOCK_STALE_MS;
  } catch {
    return true;
  }
}

function release(lock: string): void {
  try {
    fs.rmdirSync(lock);
  } catch {
    // the owner still has it, or it is already gone
  }
}

/** Waits for the lock, breaking a stale one; false when it stays held past the stale window. */
function acquire(lock: string): boolean {
  const start = Date.now();

  for (;;) {
    if (tryTake(lock)) return true;

    if (isStale(lock)) {
      release(lock);
      continue;
    }

    if (Date.now() - start > LOCK_STALE_MS) return false;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(INT32_BYTES)), 0, 0, LOCK_POLL_MS);
  }
}

/** Runs `fn` holding the ledger lock under `home`; `{ busy: true }` when the lock cannot be had. */
export function withLock<T>(home: string, fn: () => T): T | { busy: true } {
  const dir = path.join(home, ".workerstack");
  fs.mkdirSync(dir, { mode: SECRET_DIR_MODE, recursive: true });
  const lock = path.join(dir, "jev-usage.lock");

  if (!acquire(lock)) return { busy: true };

  try {
    return fn();
  } finally {
    release(lock);
  }
}
