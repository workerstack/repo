import crossSpawn from "cross-spawn"

/**
 * child_process twins for starting package managers. On Windows npm, pnpm, and yarn are
 * .cmd shims that child_process cannot start without a shell (spawnSync npm ENOENT);
 * cross-spawn resolves and escapes them. Elsewhere it is plain spawnSync.
 */
export function spawnSync(cmd, args, opts) {
  return crossSpawn.sync(cmd, args, opts)
}

/** execFileSync semantics: throw unless the command exits 0. */
export function execFileSync(cmd, args, opts) {
  const r = spawnSync(cmd, args, opts)
  if (r.error) throw r.error
  if (r.status !== 0) {
    throw new Error(`${cmd} ${args.join(" ")} exited with ${r.status ?? r.signal}`)
  }
  return r.stdout
}
