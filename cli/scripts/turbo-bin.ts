/** Finds and starts turbo's platform binary directly, so a repo with no node on PATH still runs it. */
import path from "node:path";

import { childEnv } from "../env.ts";
import { spawnSync } from "../spawn.ts";
import type { TurboRun } from "./ci-turbo.ts";
import {
  MAX_BUFFER,
  TURBO_BINARY,
  TURBO_BINARY_WINDOWS,
  TURBO_MANIFEST,
  TURBO_MISSING,
  TURBO_SCOPE,
  WINDOWS_PLATFORM,
  platformMissing,
  turboArch,
  turboOs,
} from "./turbo-bin.constants.ts";

/** Resolves a module specifier from a directory to a file path, throwing when it cannot. */
export type Resolve = (specifier: string, from: string) => string;

/** The platform and architecture to find the binary for. */
export type Target = { platform: string; arch: string };

/** Where turbo's binary is, or the line that says why it cannot be found. */
export type TurboBin = { ok: true; path: string } | { ok: false; error: string };

function resolveFrom(specifier: string, from: string): string {
  return Bun.resolveSync(specifier, from);
}

/** Where turbo is looked up from: this package's own install, as turbo is its dependency and not the consumer's. */
const OWN_DIR = import.meta.dirname;
const here: Target = { arch: process.arch, platform: process.platform };

/** The binary of the platform package of the turbo installed beside `from` (this package's own install by default). */
export function turboBin(from: string = OWN_DIR, resolve: Resolve = resolveFrom, target: Target = here): TurboBin {
  let turboDir: string;

  try {
    turboDir = path.dirname(resolve(TURBO_MANIFEST, from));
  } catch {
    return { error: TURBO_MISSING, ok: false };
  }

  const name = `${TURBO_SCOPE}${turboOs(target.platform)}-${turboArch(target.arch)}`;

  try {
    const dir = path.dirname(resolve(`${name}/package.json`, turboDir));

    return {
      ok: true,
      path: path.join(dir, target.platform === WINDOWS_PLATFORM ? TURBO_BINARY_WINDOWS : TURBO_BINARY),
    };
  } catch {
    return { error: platformMissing(name), ok: false };
  }
}

/** A runner that starts the binary `locate` finds, in the directory it is given, with `env` over the process's. */
export function turboRunner(locate: () => TurboBin = turboBin): TurboRun {
  return (args, cwd, env) => {
    const bin = locate();

    if (!bin.ok) return { missing: bin.error };
    const run = spawnSync(bin.path, args, { cwd, encoding: "utf8", env: childEnv(env), maxBuffer: MAX_BUFFER });

    return { code: run.status ?? 1, stderr: run.stderr, stdout: run.stdout };
  };
}
