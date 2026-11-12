import { spawnSync } from "node:child_process";

import { WINDOWS_PLATFORM } from "../actionlint.constants.ts";
import {
  LIST_TIMEOUT_MS,
  PID_FLAG,
  POWERSHELL,
  POWERSHELL_ARGS,
  TASKKILL,
  TASKKILL_FLAGS,
} from "./job-tree.constants.ts";

/** What `spawnSync` is used for here: run a file with args and options, hand back its stdout. */
export type Runner = (
  file: string,
  args: string[],
  options: { encoding: "utf8"; stdio?: "ignore"; timeout?: number; windowsHide: true },
) => { stdout?: string | null | undefined };

/** One `pid parentPid` line, for `matchAll`. */
const PID_PAIR = /^\s*(\d+)\s+(\d+)\s*$/gm;

/** Parses `pid parentPid` lines into [pid, parentPid] pairs, skipping anything else. */
function parsePairs(text: string): [number, number][] {
  return [...text.matchAll(PID_PAIR)].map(([, pid, parent]) => [Number(pid), Number(parent)]);
}

/** Every pid below `root` by parent pid, children first found first. `root` itself may be long dead. */
export function descendantsOf(root: number, pairs: [number, number][]): number[] {
  const found = new Set<number>();
  const queue = [root];

  for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
    for (const [pid, parent] of pairs) {
      if (parent === next && pid !== root && !found.has(pid)) {
        found.add(pid);
        queue.push(pid);
      }
    }
  }

  return [...found];
}

/**
 * A run that failed to finish (killed for output or time) leaves its process tree alive on Windows: spawnSync ends only
 * the shell shim, so taskkill /T on the dead shim's pid finds no tree, and the shim's child would keep the run's cwd
 * open. A process keeps its parent pid after the parent dies, so the descendants are found by that and ended with the
 * root. Says so; false elsewhere.
 */
export function endTreeAfterError(
  run: { error?: Error | undefined; pid?: number | undefined },
  platform: NodeJS.Platform = process.platform,
  runner: Runner = spawnSync,
): boolean {
  const { error, pid: rootPid } = run;

  if (error === undefined || platform !== WINDOWS_PLATFORM || rootPid === undefined || rootPid === 0) return false;
  const listed = runner(POWERSHELL, POWERSHELL_ARGS, { encoding: "utf8", timeout: LIST_TIMEOUT_MS, windowsHide: true });
  const pids = [rootPid, ...descendantsOf(rootPid, parsePairs(listed.stdout ?? ""))];
  const targets = pids.flatMap((pid) => [PID_FLAG, String(pid)]);
  runner(TASKKILL, [...TASKKILL_FLAGS, ...targets], { encoding: "utf8", stdio: "ignore", windowsHide: true });

  return true;
}
