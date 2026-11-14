/** Run git for its output, with why it failed in the words git printed. */
import { execFileSync } from "node:child_process";

/** Path lists from `git status` or `git diff` may be large in a big tree; 256 MiB. */
const GIT_MAX_BUFFER = 268_435_456;

/** git's stdout, or its stderr (else the error message) when it fails. */
export function gitOutput(cwd: string, args: readonly string[]): { out: string } | { why: string } {
  try {
    const out = execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      maxBuffer: GIT_MAX_BUFFER,
      stdio: ["ignore", "pipe", "pipe"],
    });

    return { out };
  } catch (e) {
    const { stderr, message } = e /* execFileSync throws an Error carrying the child's stderr, if it ran */ as Error & {
      stderr?: string | null;
    };

    return { why: (stderr !== undefined && stderr !== null && stderr !== "" ? stderr : message).trim() };
  }
}
