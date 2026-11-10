import { spawnSync } from "node:child_process";
import path from "node:path";

/**
 * Runs `git <args>` in `cwd` for a command that prints one path; the native, absolute path (git prints forward slashes
 * on Windows), or null when git fails or is missing.
 */
export function linkGit(cwd: string, args: readonly string[]): string | null {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  return result.status === 0 ? path.resolve(cwd, result.stdout.trim()) : null;
}
