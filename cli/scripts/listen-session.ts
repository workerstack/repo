/** Where `repo listen` keeps its recording session and last transcript, and whether a recorder still runs. */
import fs from "node:fs";
import path from "node:path";

import {
  JSON_INDENT,
  LATEST_FILE,
  LISTEN_DIR,
  SESSION_FILE,
  SLEEP_CELL_BYTES,
  STOP_POLL_MS,
  STOP_WAIT_MS,
} from "./listen.constants.ts";
import type { KillFn } from "./listen.types.ts";
import { readJson } from "./voice-args.ts";
import { resolveRoots } from "./workspace-root.ts";

/** The listen dir under the repo root, made when missing. */
export function listenDir(cwd: string): string {
  const d = path.join(resolveRoots({}, { cwd }).root, LISTEN_DIR);
  fs.mkdirSync(d, { recursive: true });
  return d;
}

export function sessionPath(cwd: string): string {
  return path.join(listenDir(cwd), SESSION_FILE);
}

export function latestPath(cwd: string): string {
  return path.join(listenDir(cwd), LATEST_FILE);
}

export function readSession(cwd: string): Record<string, unknown> {
  return readJson(sessionPath(cwd));
}

export function writeSession(cwd: string, obj: Record<string, unknown>): void {
  fs.writeFileSync(sessionPath(cwd), JSON.stringify(obj, null, JSON_INDENT) + "\n");
}

export function clearSession(cwd: string): void {
  fs.rmSync(sessionPath(cwd), { force: true });
}

/** Whether `pid` answers signal 0; a non-positive or non-numeric pid is never probed. */
export function pidAlive(pid: unknown, killFn: KillFn): boolean {
  const n = Number(pid);
  if (!Number.isFinite(n) || n <= 0) return false;
  try {
    killFn(n, 0);
    return true;
  } catch {
    return false;
  }
}

/** Blocks until `pid` exits or eight seconds pass. */
export function waitPidExit(pid: number, killFn: KillFn): void {
  const start = Date.now();
  while (Date.now() - start < STOP_WAIT_MS) {
    if (!pidAlive(pid, killFn)) return;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(SLEEP_CELL_BYTES)), 0, 0, STOP_POLL_MS);
  }
}
