/**
 * The child `cssDiagnostics` spawns: `bun stylelint-run.ts [--fix] <file>…` in the checkout's root lints (and with
 * `--fix` fixes) the root-relative files with the config of `stylelint-config.ts`, its extends resolved from this dir,
 * and prints the results as json. Stylelint's API is async; a child keeps the checks that call it sync.
 */
import stylelint from "stylelint";

import { stylelintConfig } from "./stylelint-config.ts";
import { ARGS_START, FIX_FLAG } from "./stylelint.constants.ts";

/** The results of `argv`'s files as json: each file's path, its warnings and its config's invalid options. */
export async function stylelintRun(argv: readonly string[]): Promise<string> {
  const shouldFix = argv[0] === FIX_FLAG;
  const linted = await stylelint.lint({
    allowEmptyInput: true,
    config: await stylelintConfig(),
    configBasedir: import.meta.dirname,
    cwd: process.cwd(),
    files: shouldFix ? argv.slice(1) : [...argv],
    fix: shouldFix,
  });
  const results = linted.results.map((result) => ({
    invalid: result.invalidOptionWarnings.map((warning) => warning.text),
    source: result.source ?? "",
    warnings: result.warnings.map(({ column, line, rule, severity, text }) => ({ column, line, rule, severity, text })),
  }));
  return JSON.stringify(results);
}

/** Prints the results, or the error's message on stderr with exit code 1. */
async function main(argv: readonly string[]): Promise<void> {
  try {
    process.stdout.write(await stylelintRun(argv));
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

if (import.meta.main) await main(process.argv.slice(ARGS_START));
