import { readEnv } from "../env.ts";
import type { Env } from "../env.ts";
/** TTY / CI / --yes probe. Copied into consumers; no clack. */

type InteractiveOptions = {
  argv?: string[];
  env?: Env;
  stdin?: { isTTY?: boolean };
  stdout?: { isTTY?: boolean };
};

/**
 * True only when both streams are TTYs, CI is unset or falsy, and no `--yes`/`-y`/`--non-interactive` flag is present.
 * @param [options]
 * @returns
 */
export function isInteractive({
  argv = process.argv.slice(2),
  env = readEnv(),
  stdin = process.stdin,
  stdout = process.stdout,
}: InteractiveOptions = {}): boolean {
  if (!stdin?.isTTY || !stdout?.isTTY) return false;
  const ci = env.CI;
  if (ci != null && ci !== "" && ci !== "0" && ci !== "false") return false;
  for (const a of argv) if (a === "--yes" || a === "-y" || a === "--non-interactive") return false;

  return true;
}
