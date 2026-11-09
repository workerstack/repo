/** TTY / CI / --yes probe. Copied into consumers; no clack. */

interface InteractiveOptions {
  argv?: string[];
  env?: Record<string, string | undefined>;
  stdin?: { isTTY?: boolean; };
  stdout?: { isTTY?: boolean; };
}

/**
 * True only when both streams are TTYs, CI is unset or falsy, and no `--yes`/`-y`/`--non-interactive` flag is present.
 * @param [options]
 * @returns
 */
export function isInteractive({
  argv = process.argv.slice(2),
  env = process.env,
  stdin = process.stdin,
  stdout = process.stdout,
}: InteractiveOptions = {}): boolean {
  if (!stdin?.isTTY || !stdout?.isTTY) return false;
  const ci = env.CI;
  if (ci != null && ci !== "" && ci !== "0" && ci !== "false") return false;
  for (const a of argv) {
    if (a === "--yes" || a === "-y" || a === "--non-interactive") return false;
  }
  return true;
}
