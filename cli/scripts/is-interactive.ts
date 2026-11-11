import { readEnv } from "../env.ts";
import type { Env } from "../env.ts";
import { ARGV_START, YES_FLAGS } from "../main.constants.ts";
import { CI_OFF_VALUES } from "./ci-off-values.constants.ts";
/** TTY / CI / --yes probe. Copied into consumers; no clack. */

type InteractiveOptions = {
  argv?: string[];
  env?: Env;
  stdin?: { isTTY?: boolean };
  stdout?: { isTTY?: boolean };
};

/** Whether `ci`, the value of `CI`, says a CI run: set to anything but empty, `0` or `false`. */
function isCi(ci: string | undefined): boolean {
  return ci !== undefined && !CI_OFF_VALUES.includes(ci);
}

/**
 * True only when both streams are TTYs, CI is unset or falsy, and no `--yes`/`-y`/`--non-interactive` flag is present.
 * @param [options]
 * @returns
 */
export function isInteractive({
  argv = process.argv.slice(ARGV_START),
  env = readEnv(),
  stdin = process.stdin,
  stdout = process.stdout,
}: InteractiveOptions = {}): boolean {
  if (stdin.isTTY !== true || stdout.isTTY !== true) return false;
  return !isCi(env.CI) && !argv.some((arg) => YES_FLAGS.has(arg));
}
