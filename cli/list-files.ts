import { execFileSync } from "node:child_process";

/**
 * Files under `cwd` that `git ls-files -z` lists with `args` (default: tracked and untracked, not ignored), posix and
 * relative to it, each once; none outside a git repo.
 */
export function listFiles(cwd: string, args: readonly string[] = ["-co", "--exclude-standard"]): string[] {
  try {
    const out = execFileSync("git", ["ls-files", "-z", ...args], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return [...new Set(out.split("\0").filter((rel) => rel !== ""))];
  } catch {
    return [];
  }
}
