import { execFileSync } from "node:child_process";
import fs from "node:fs";

/**
 * Another spelling of the existing dir `dir`: its 8.3 short form on Windows (a junction when the volume has no
 * short names), else a symlink `${dir}-alias` beside it, which the caller removes after the test.
 */
export function aliasOf(dir: string): string {
  if (process.platform === "win32") {
    // Verbatim, since node's quoting of the inner quotes is not cmd's; /s strips the outer pair.
    const short = execFileSync("cmd", ["/d", "/s", "/c", `"for %I in ("${dir}") do @echo %~sI"`], {
      encoding: "utf8",
      windowsVerbatimArguments: true,
    }).trim();
    if (short && short.toLowerCase() !== dir.toLowerCase()) return short;
  }
  const link = `${dir}-alias`;
  if (!fs.existsSync(link)) fs.symlinkSync(dir, link, "junction");
  return link;
}
