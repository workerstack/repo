/** TTY / CI / --yes probe. Copied into consumers; no clack. */

/**
 * @typedef {object} InteractiveOptions
 * @property {string[]} [argv] Defaults to the process arguments.
 * @property {Record<string, string | undefined>} [env] Defaults to `process.env`.
 * @property {{ isTTY?: boolean }} [stdin] Defaults to `process.stdin`.
 * @property {{ isTTY?: boolean }} [stdout] Defaults to `process.stdout`.
 */

/**
 * True only when both streams are TTYs, CI is unset or falsy, and no `--yes`/`-y`/`--non-interactive` flag is present.
 * @param {InteractiveOptions} [options]
 * @returns {boolean}
 */
export function isInteractive({
  argv = process.argv.slice(2),
  env = process.env,
  stdin = process.stdin,
  stdout = process.stdout,
} = {}) {
  if (!stdin?.isTTY || !stdout?.isTTY) return false;
  const ci = env.CI;
  if (ci != null && ci !== "" && ci !== "0" && ci !== "false") return false;
  for (const a of argv) {
    if (a === "--yes" || a === "-y" || a === "--non-interactive") return false;
  }
  return true;
}
