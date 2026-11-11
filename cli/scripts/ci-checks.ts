/** The commands `ci.checks` names, each run from the repo root as a gate of `repo ci`. */
import type { SpawnSyncOptionsWithStringEncoding, SpawnSyncReturns } from "node:child_process";

import { spawnSync } from "../spawn.ts";
import { fail, pass, textOf, type Gate } from "./ci-gate.ts";
import { NOT_FOUND_CODE } from "./ci.constants.ts";

/** Starts a command with an argv; `cli/spawn.ts` by default, so a Windows `.cmd` shim starts. */
export type CiSpawn = (
  cmd: string,
  args: string[],
  opts: SpawnSyncOptionsWithStringEncoding,
) => SpawnSyncReturns<string>;

/** The spawner `repo ci` uses unless one is injected. */
export const defaultSpawn: CiSpawn = (cmd, args, opts) => spawnSync(cmd, args, opts);

/** Why a command did not start: not on PATH, or the spawn error's own message. */
function whyNot(error: Error, cmd: string): string {
  return "code" in error && error.code === NOT_FOUND_CODE ? `${cmd} not found` : error.message;
}

/** Runs `argv` in `run.root` as the gate `name`: its label says ok, the exit code, or why it did not start. */
export function checkGate(name: string, argv: readonly string[], run: { root: string; spawn: CiSpawn }): Gate {
  const cmd = argv[0] /* the config schema refuses an empty argv */ as string;
  const done = run.spawn(cmd, argv.slice(1), { cwd: run.root, encoding: "utf8" });
  if (done.error) return fail(`${name} failed (${whyNot(done.error, cmd)})`, [], false);
  if (done.status === 0) return pass(`${name} ok`);
  const output = textOf({ code: done.status ?? 1, stderr: done.stderr, stdout: done.stdout });
  return fail(`${name} failed (exit ${done.status ?? done.signal})`, [output]);
}
