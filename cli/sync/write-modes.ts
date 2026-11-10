import fs from "node:fs";
import path from "node:path";
import type { Output } from "./outputs.ts";
import { OWNED_EXECUTABLE_MODE, OWNED_MODE, OWNER_WRITE, PERMISSION_BITS, WRITABLE_MODE } from "./write.constants.ts";

/**
 * The mode sync leaves a file output at: a whole file read-only, 0444, or 0555 for an executable one off win32,
 * which has no execute bits. Null for a block output, which the user also writes, and for a link.
 */
export function ownedMode(output: Output, platform: NodeJS.Platform): number | null {
  if (output.kind === "link" || output.managed === "block") return null;
  return output.executable === true && platform !== "win32" ? OWNED_EXECUTABLE_MODE : OWNED_MODE;
}

/**
 * Gives each whole file output its owned mode again, since git keeps no read-only bit and a checkout resets it.
 * Only a path `lstat` shows is a regular file is touched: a chmod follows a link into what it points to. One
 * warning per file that cannot be changed.
 */
export function settleModes(root: string, outputs: readonly Output[], platform: NodeJS.Platform): string[] {
  return outputs.flatMap((output) => {
    const mode = ownedMode(output, platform);
    const abs = path.join(root, output.path);
    if (mode === null || !isFileAtOtherMode(abs, mode)) return [];
    try {
      fs.chmodSync(abs, mode);
      return [];
    } catch (error) {
      return [`cannot make ${output.path} read-only: ${(error /* fs throws only Error */ as Error).message}`];
    }
  });
}

/** What `lstat` says is at `abs`, or null when nothing is or a parent is not a dir. */
function lstatOrNull(abs: string): fs.Stats | null {
  try {
    return fs.lstatSync(abs);
  } catch {
    return null;
  }
}

/** Whether `abs` is a regular file, not a link, whose permission bits are not `mode`. */
function isFileAtOtherMode(abs: string, mode: number): boolean {
  const stat = lstatOrNull(abs);
  return stat !== null && stat.isFile() && (stat.mode & PERMISSION_BITS) !== mode;
}

/**
 * Makes a read-only regular file at `abs` writable, since win32 refuses a rename onto it and its removal. A link is
 * left alone, so its target never changes; a missing path has nothing to do.
 */
export function unlock(abs: string): void {
  const stat = lstatOrNull(abs);
  if (stat !== null && stat.isFile() && (stat.mode & OWNER_WRITE) === 0) fs.chmodSync(abs, WRITABLE_MODE);
}
