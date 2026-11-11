/**
 * The module whose `main` the child `cssDiagnostics` spawns runs: `bun --eval <RUNNER_EVAL> <this file's URL> [--fix]
 * <file>…` in the checkout's root lints (and with `--fix` fixes) the root-relative files with the config of
 * `stylelint-config.ts`, its extends resolved from this dir, and prints the results as json. Stylelint's API is async;
 * a child keeps the checks that call it sync.
 */
import stylelint from "stylelint";

import { stylelintConfig } from "./stylelint-config.ts";
import { FIX_FLAG } from "./stylelint.constants.ts";

/** Where the child writes: its stdout or its stderr. */
export type Write = (text: string) => void;

/**
 * The results of `argv`'s files (fixed first when `--fix` is among them) as json: each file's path, its warnings and
 * its config's invalid options.
 */
export async function stylelintRun(argv: readonly string[]): Promise<string> {
  const linted = await stylelint.lint({
    allowEmptyInput: true,
    config: await stylelintConfig(),
    configBasedir: import.meta.dirname,
    cwd: process.cwd(),
    files: argv.filter((arg) => arg !== FIX_FLAG),
    fix: argv.includes(FIX_FLAG),
  });
  const results = linted.results.map((result) => ({
    invalid: result.invalidOptionWarnings,
    source: result.source,
    warnings: result.warnings.map(({ column, line, rule, severity, text }) => ({ column, line, rule, severity, text })),
  }));
  return JSON.stringify(results);
}

/** Writes the results to `out` and gives exit code 0, or the error to `err` and 1. */
export async function main(argv: readonly string[], out: Write, err: Write): Promise<number> {
  try {
    out(await stylelintRun(argv));
    return 0;
  } catch (error) {
    err(`${String(error)}\n`);
    return 1;
  }
}
