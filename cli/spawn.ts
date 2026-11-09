import type { SpawnSyncOptions, SpawnSyncOptionsWithStringEncoding, SpawnSyncReturns } from "node:child_process";
import crossSpawn from "cross-spawn";

/**
 * child_process twins for starting bun and the tools it installs. On Windows a package bin is a
 * .cmd shim that child_process cannot start without a shell (spawnSync ENOENT); cross-spawn
 * resolves and escapes it. Elsewhere it is plain spawnSync.
 */
export function spawnSync(
  cmd: string,
  args: string[],
  opts: SpawnSyncOptionsWithStringEncoding,
): SpawnSyncReturns<string>;
export function spawnSync(cmd: string, args: string[], opts?: SpawnSyncOptions): SpawnSyncReturns<Buffer>;
export function spawnSync(cmd: string, args: string[], opts?: SpawnSyncOptions): SpawnSyncReturns<string | Buffer> {
  return crossSpawn.sync(cmd, args, opts);
}

/** execFileSync semantics: throw unless the command exits 0. */
export function execFileSync(cmd: string, args: string[], opts?: SpawnSyncOptions): string | Buffer {
  const r = spawnSync(cmd, args, opts);
  if (r.error) throw r.error;
  if (r.status !== 0) {
    throw new Error(`${cmd} ${args.join(" ")} exited with ${r.status ?? r.signal}`);
  }
  return r.stdout;
}
