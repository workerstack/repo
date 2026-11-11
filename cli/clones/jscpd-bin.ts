/** Finds jscpd's platform binary, which its package ships as an optional dependency per OS and architecture. */
import path from "node:path";

import {
  JSCPD_BINARY,
  JSCPD_BINARY_WINDOWS,
  JSCPD_MANIFEST,
  JSCPD_OS,
  JSCPD_PREFIX,
  LINUX_LIBCS,
  LINUX_PLATFORM,
  WINDOWS_PLATFORM,
  WINDOWS_SUFFIX,
  platformMissing,
} from "./jscpd-bin.constants.ts";

/** The platform and architecture to find the binary for. */
export type Target = { platform: string; arch: string };
/** Where jscpd's binary is, or the line that says why it cannot be found. */
export type JscpdBin = { ok: true; path: string } | { ok: false; error: string };
/** A platform package that could hold the binary, and the binary's path inside it. */
type Candidate = { name: string; binary: string };

const here: Target = { arch: process.arch, platform: process.platform };

/** Resolves `specifier` from this package's install, or null when it is not installed. */
function resolved(specifier: string, from: string): string | null {
  try {
    // Bun.resolveSync, not import.meta.resolve: vitest's transform drops the latter, and tests run this in-process.
    return Bun.resolveSync(specifier, from);
  } catch {
    return null;
  }
}

/** The platform packages that could hold the binary for `target`, the likeliest first. */
function candidates(target: Target): Candidate[] {
  const name = `${JSCPD_PREFIX}${JSCPD_OS[target.platform] ?? target.platform}-${target.arch}`;
  if (target.platform === LINUX_PLATFORM)
    return LINUX_LIBCS.map((libc) => ({ binary: JSCPD_BINARY, name: `${name}${libc}` }));
  if (target.platform === WINDOWS_PLATFORM) return [{ binary: JSCPD_BINARY_WINDOWS, name: `${name}${WINDOWS_SUFFIX}` }];
  return [{ binary: JSCPD_BINARY, name }];
}

/**
 * The binary of the platform package of the jscpd this package installs, for `target` (this host by default). jscpd
 * is a dependency, so its manifest always resolves; the platform packages resolve from beside it.
 */
export function jscpdBin(target: Target = here): JscpdBin {
  const from = path.dirname(Bun.resolveSync(JSCPD_MANIFEST, import.meta.dirname));
  const names = candidates(target);
  for (const { name, binary } of names) {
    const found = resolved(`${name}/package.json`, from);
    if (found !== null) return { ok: true, path: path.join(path.dirname(found), binary) };
  }
  return { error: platformMissing(names.map(({ name }) => name).join(" or ")), ok: false };
}
