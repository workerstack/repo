import { execFileSync, type ExecFileSyncOptionsWithStringEncoding } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { WIN32 } from "../cli/lint/native-path-separator.constants.ts";
import { canonicalPath } from "../cli/scripts/workspace-root.ts";

/**
 * Another spelling of the existing dir `dir`: its 8.3 short form on Windows (a junction when the volume has no
 * short names), else a symlink `${dir}-alias` beside it, which the caller removes after the test.
 */
export function aliasOf(dir: string): string {
  if (process.platform === WIN32) {
    // Verbatim, since node's quoting of the inner quotes is not cmd's; /s strips the outer pair.
    // node forwards this to spawnSync, but @types/node omits it from the execFileSync option types.
    const opts: ExecFileSyncOptionsWithStringEncoding & { windowsVerbatimArguments: boolean } = {
      encoding: "utf8",
      windowsVerbatimArguments: true,
    };

    const short = execFileSync("cmd", ["/d", "/s", "/c", `"for %I in ("${dir}") do @echo %~sI"`], opts).trim();

    if (short !== "" && short.toLowerCase() !== dir.toLowerCase()) return short;
  }

  const link = `${dir}-alias`;

  if (!fs.existsSync(link)) fs.symlinkSync(dir, link, "junction");

  return link;
}

/** Removes an alias `aliasOf` made: its `-alias` link; an 8.3 short name is the dir itself and stays. */
export function removeAlias(alias: string): void {
  if (fs.lstatSync(alias, { throwIfNoEntry: false })?.isSymbolicLink() === true) fs.unlinkSync(alias);
}

/**
 * `abs` as the product prints a path a shell runs: canonical (8.3 names and links resolved) with forward
 * slashes.
 */
export function shellForm(abs: string): string {
  return canonicalPath(abs).split(path.sep).join("/");
}

/**
 * The installed bin as a hook's rewritten command names it: `.exe` on Windows, where bun runs a bin through its
 * shim.
 */
export function installedBin(root: string): string {
  return `${shellForm(root)}/node_modules/.bin/repo${process.platform === WIN32 ? ".exe" : ""}`;
}

/**
 * A link's target relative to its dir in forward slashes: what a relative link holds, and a win32 junction's absolute
 * target read back that way. An absolute target and the link's dir go through `canonicalPath`, except the target's last
 * segment, which is never followed.
 */
export function linkText(link: string): string {
  const held = fs.readlinkSync(link);

  // A relative target is already relative to the link's dir, in whatever spelling the dir has.
  if (!path.isAbsolute(held)) return path.normalize(held).split(path.sep).join("/");
  const dir = canonicalPath(path.dirname(link));
  const resolved = path.join(canonicalPath(path.dirname(held)), path.basename(held));

  return path.relative(dir, resolved).split(path.sep).join("/");
}

const found: { bun?: string } = {};

/**
 * The bun binary, asked of bun on first use and kept: tests spawn repo scripts with it, since process.execPath is
 * node under vitest.
 */
export function bunPath(): string {
  found.bun ??= execFileSync("bun", ["-e", "process.stdout.write(process.execPath)"], { encoding: "utf8" });

  return found.bun;
}

/**
 * A path spelled with forward slashes: how git, a shell command and a recorded list name it, whatever the host's
 * separator.
 */
export function fwd(p: string): string {
  return p.split(path.sep).join("/");
}
