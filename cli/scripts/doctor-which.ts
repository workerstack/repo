/** Finding a binary on PATH the way the shell would, and the print-only line that installs a missing one. */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { repoEnv } from "../repo-env.ts";
import {
  CHROMIUM_BINS,
  DARWIN,
  HINT_ALL,
  PATHEXT_DEFAULT,
  REQUIRED,
  VERSION_TIMEOUT_MS,
  WIN32,
  installHintsOf,
} from "./doctor.constants.ts";
import type { InstallHints } from "./doctor.types.ts";

/** Whether this host is Windows, and whether the lookup should act like it (host or target platform). */
type Host = { hostWin: boolean; winLike: boolean };

const WIN_SHIM_RE = /\.(cmd|bat)$/i;
const PATH_SEP = ";";

export function winShim(bin: string): boolean {
  return process.platform === WIN32 && WIN_SHIM_RE.test(bin);
}

function pathDirs(pathEnv: string | undefined, host: Host): string[] {
  const text = pathEnv ?? "";

  return text.split(host.winLike && text.includes(PATH_SEP) ? PATH_SEP : path.delimiter);
}

/** The file names `name` may have on disk: with each PATHEXT suffix on a Windows host, `.exe`, then bare. */
function candidateNames(name: string, host: Host): string[] {
  if (!host.winLike || path.extname(name) !== "") return [name];
  const names: string[] = [];

  if (host.hostWin) {
    const fromEnv = repoEnv.process.PATHEXT ?? "";
    const pathext = fromEnv === "" ? PATHEXT_DEFAULT : fromEnv;

    for (const raw of pathext.split(PATH_SEP)) if (raw !== "") names.push(name + raw.toLowerCase(), name + raw);
  }

  names.push(`${name}.exe`, name);

  return [...new Set(names)];
}

/** Executable, or on a Windows host (no exec bit) merely present. */
function canRun(candidate: string, host: Host): boolean {
  try {
    fs.accessSync(candidate, fs.constants.X_OK);

    return true;
  } catch {
    // not executable
  }

  if (!host.hostWin) return false;

  try {
    fs.accessSync(candidate, fs.constants.F_OK);

    return true;
  } catch {
    return false;
  }
}

export function whichBin(
  name: string,
  pathEnv: string | undefined = repoEnv.process.PATH,
  platform: string = process.platform,
): string {
  if (name === "") return "";
  const isHostWin = process.platform === WIN32;
  const host = { hostWin: isHostWin, winLike: isHostWin || platform === WIN32 };
  const names = candidateNames(name, host);

  for (const dir of pathDirs(pathEnv, host)) {
    if (dir === "") continue;
    const hit = names.map((n) => path.join(dir, n)).find((c) => canRun(c, host));

    if (hit !== undefined) return hit;
  }

  return "";
}

/** PATH with the checkout's `node_modules/.bin` first, so a bunx-able tool counts as found. */
export function withNmBin(cwd: string, pathEnv: string | undefined, platform: string): string {
  const nm = path.join(cwd, "node_modules", ".bin");
  const d = platform === WIN32 && (pathEnv ?? "").includes(PATH_SEP) ? PATH_SEP : path.delimiter;

  return `${nm}${d}${pathEnv ?? ""}`;
}

export function readVersion(bin: string, flag: string): string {
  try {
    return execFileSync(bin, [flag], {
      encoding: "utf8",
      shell: winShim(bin),
      stdio: ["ignore", "pipe", "pipe"],
      timeout: VERSION_TIMEOUT_MS,
    }).trim();
  } catch {
    return "";
  }
}

export function lookupChromium(pathEnv: string | undefined, platform: string): string {
  for (const n of CHROMIUM_BINS) {
    const hit = whichBin(n, pathEnv, platform);

    if (hit !== "") return hit;
  }

  return "";
}

function platformHints(hints: InstallHints, platform: string): readonly string[] | undefined {
  if (platform === WIN32) return hints.win32;

  if (platform === DARWIN) return hints.darwin;

  return undefined;
}

export function installHints(id: string, platform: string = process.platform): string[] {
  if (id === HINT_ALL) return REQUIRED.flatMap((k) => installHints(k, platform));
  const byOs = installHintsOf(id);

  if (byOs === undefined) return [];

  return [...(platformHints(byOs, platform) ?? byOs.other)];
}
