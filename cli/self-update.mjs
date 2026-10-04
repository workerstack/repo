import { spawnSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { GRUNT_PACKAGE, samePath } from "./init.mjs"
import { addDevArgs } from "../scripts/package-manager.mjs"

/** Set on the re-execed child so it never self-updates again. */
export const REEXEC_ENV = "GRUNT_SELF_UPDATED"
const DEFAULT_REGISTRY = "https://registry.npmjs.org"
const TIMEOUT_MS = 5000
const VERSION_RE = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/

function parseVersion(v) {
  const m = VERSION_RE.exec(String(v).trim())
  if (!m) return null
  return { nums: [Number(m[1]), Number(m[2]), Number(m[3])], pre: m[4] ?? null }
}

/** -1 | 0 | 1. A prerelease sorts below its release. */
export function compareVersions(a, b) {
  const pa = parseVersion(a)
  const pb = parseVersion(b)
  for (let i = 0; i < 3; i++) {
    if (pa.nums[i] !== pb.nums[i]) return pa.nums[i] < pb.nums[i] ? -1 : 1
  }
  if (pa.pre === pb.pre) return 0
  if (pa.pre == null) return 1
  if (pb.pre == null) return -1
  return pa.pre < pb.pre ? -1 : 1
}

/** Latest dist-tag version, or null when the registry is unreachable or answers junk. */
export async function fetchLatestVersion({ fetch = globalThis.fetch, env = process.env } = {}) {
  const base = String(env.npm_config_registry || DEFAULT_REGISTRY).replace(/\/+$/, "")
  const url = `${base}/${GRUNT_PACKAGE.replace("/", "%2f")}/latest`
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) })
    if (!res.ok) return null
    const { version } = await res.json()
    return parseVersion(version) ? version : null
  } catch {
    return null
  }
}

function warn(m) {
  process.stderr.write(`${m}\n`)
}

/**
 * Install the latest grunt as a devDependency, then re-run the same command with the
 * installed bin so the merge uses the new package. Returns `{ reexeced, status? }`.
 */
export async function selfUpdate({
  cwd,
  pkgRoot,
  currentVersion,
  pm,
  argv,
  env = process.env,
  fetch = globalThis.fetch,
  run = spawnSync,
  log = warn,
}) {
  if (env[REEXEC_ENV]) return { reexeced: false }
  if (samePath(cwd, pkgRoot)) return { reexeced: false }

  const latest = await fetchLatestVersion({ fetch, env })
  if (!latest) {
    log(`grunt: could not check the registry for updates; upgrading with ${currentVersion}`)
    return { reexeced: false }
  }
  if (compareVersions(currentVersion, latest) >= 0) return { reexeced: false }

  log(`grunt: updating ${currentVersion} -> ${latest}`)
  const install = run(pm, addDevArgs(pm, `${GRUNT_PACKAGE}@${latest}`, { cwd }), {
    cwd,
    stdio: "inherit",
  })
  if (install.error || install.status !== 0) {
    throw new Error(`grunt: ${pm} install of ${GRUNT_PACKAGE}@${latest} failed`)
  }

  const bin = path.join(cwd, "node_modules", GRUNT_PACKAGE, "bin", "grunt.js")
  const opts = { cwd, stdio: "inherit", env: { ...env, [REEXEC_ENV]: "1" } }
  let child
  if (fs.existsSync(bin)) {
    child = run(process.execPath, [bin, ...argv], opts)
  } else if (fs.existsSync(path.join(cwd, ".pnp.cjs"))) {
    // Yarn Plug'n'Play has no node_modules; yarn resolves the bin from the updated .pnp.cjs.
    child = run("yarn", ["grunt", ...argv], opts)
  } else {
    log(`grunt: ${bin} not found after install; upgrading with ${currentVersion}`)
    return { reexeced: false }
  }
  return { reexeced: true, status: child.status ?? 1 }
}
