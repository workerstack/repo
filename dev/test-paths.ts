import { execFileSync, type ExecFileSyncOptionsWithStringEncoding } from "node:child_process";
import fs from "node:fs";

/**
 * Another spelling of the existing dir `dir`: its 8.3 short form on Windows (a junction when the volume has no
 * short names), else a symlink `${dir}-alias` beside it, which the caller removes after the test.
 */
export function aliasOf(dir: string): string {
  if (process.platform === "win32") {
    // Verbatim, since node's quoting of the inner quotes is not cmd's; /s strips the outer pair.
    // node forwards this to spawnSync, but @types/node omits it from the execFileSync option types.
    const opts: ExecFileSyncOptionsWithStringEncoding & { windowsVerbatimArguments: boolean } = {
      encoding: "utf8",
      windowsVerbatimArguments: true,
    };
    const short = execFileSync("cmd", ["/d", "/s", "/c", `"for %I in ("${dir}") do @echo %~sI"`], opts).trim();
    if (short && short.toLowerCase() !== dir.toLowerCase()) return short;
  }
  const link = `${dir}-alias`;
  if (!fs.existsSync(link)) fs.symlinkSync(dir, link, "junction");
  return link;
}

/** The bun binary: tests spawn repo scripts with it, since process.execPath is node under vitest. */
export const BUN: string = execFileSync("bun", ["-e", "process.stdout.write(process.execPath)"], { encoding: "utf8" });
