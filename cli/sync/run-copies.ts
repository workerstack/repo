/**
 * The config copies `repo check` writes at the root for one run, named for its process, and removes in a `finally`. A
 * killed check never gets there, so sync removes each copy whose process is gone.
 */
import fs from "node:fs";
import path from "node:path";

import { errorCode } from "../sync-errors.ts";
import { byCodeUnit } from "./by-code-unit.ts";
import { KNIP_UNIGNORED_GLOB } from "./knip-config.ts";
import { UNSKIPPED_CONFIG_GLOB } from "./oxlint-config.ts";
import { JSON_RUN_COPY_GLOBS, NO_PROCESS, PID_HOLE, PID_RE } from "./run-copies.constants.ts";

/** The pid the run copy `name` is named for, or null when `name` is no run copy. */
function pidOf(name: string): number | null {
  for (const glob of [UNSKIPPED_CONFIG_GLOB, KNIP_UNIGNORED_GLOB, ...JSON_RUN_COPY_GLOBS]) {
    const hole = glob.indexOf(PID_HOLE);
    const prefix = glob.slice(0, hole);
    const suffix = glob.slice(hole + PID_HOLE.length);
    const pid = name.slice(prefix.length, name.length - suffix.length);

    if (name.startsWith(prefix) && name.endsWith(suffix) && PID_RE.test(pid)) return Number(pid);
  }

  return null;
}

/** Whether a process holds `pid`; one of another user's runs too, since `kill` then refuses rather than finds none. */
export function processRuns(
  pid: number,
  kill: (pid: number, signal: number) => boolean = (target, signal) => process.kill(target, signal),
): boolean {
  try {
    kill(pid, 0);

    return true;
  } catch (error) {
    return errorCode(error) !== NO_PROCESS;
  }
}

/** Removes each run copy at `root` whose process `alive` says is gone; the names it removed, sorted. */
export function removeStaleRunCopies(root: string, alive: (pid: number) => boolean = processRuns): string[] {
  const stale = fs
    .readdirSync(root, { withFileTypes: true })
    .filter((entry) => {
      const pid = entry.isFile() ? pidOf(entry.name) : null;

      return pid !== null && !alive(pid);
    })
    .map((entry) => entry.name)
    .toSorted(byCodeUnit);

  for (const name of stale) fs.rmSync(path.join(root, name), { force: true });

  return stale;
}
