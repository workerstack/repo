/**
 * `repo lint`: oxlint with the arguments given, or with `--baseline` alone, the baseline lowered and seeded from
 * oxlint's and the script checks' hits. The baseline and the script checks load only for `--baseline`, so a lint of
 * paths never loads typescript, nor does a lint of a repo with no root Cargo.toml.
 */
import fs from "node:fs";
import path from "node:path";
import { CARGO_MANIFEST } from "../rust/rust-hits.constants.ts";
import { findRoot } from "../config.ts";
import { lint, runTool } from "./lint.ts";

/**
 * oxlint with `argv`, then in a repo with a root Cargo.toml the Rust hits: all of them, clippy's included, for a lint
 * of no arguments; the source rules on the `.rs` paths among the paths given; none when only flags are given. Each hit
 * a `lint.skip` entry leaves is printed, and one hit or problem fails the run.
 */
async function lintAndRust(argv: string[]): Promise<number> {
  const code = await lint(argv);
  const root = findRoot(process.cwd());
  const flagsOnly = argv.length > 0 && argv.every((arg) => arg.startsWith("-"));
  if (root === null || flagsOnly || !fs.existsSync(path.join(root, CARGO_MANIFEST))) return code;
  const { rustLintAt } = await import("../script-diagnostics.ts");
  const rust = await rustLintAt(process.cwd(), argv.length === 0 ? null : argv);
  for (const line of rust.lines) process.stdout.write(`${line}\n`);
  for (const line of rust.problems) process.stderr.write(`repo lint: ${line}\n`);
  return code === 0 && rust.lines.length + rust.problems.length > 0 ? 1 : code;
}

export async function lintMain(argv: string[]): Promise<number> {
  if (!argv.includes("--baseline")) return lintAndRust(argv);
  if (argv.length > 1) {
    process.stderr.write("repo lint: --baseline takes no other arguments; it lints the whole repo\n");
    return 1;
  }
  const [{ seedBaseline }, { checkScriptsAt }] = await Promise.all([
    import("./lint-baseline.ts"),
    import("../script-diagnostics.ts"),
  ]);
  const scripts = await checkScriptsAt(process.cwd());
  if (scripts.problems.length > 0) {
    for (const line of scripts.problems) process.stderr.write(`repo lint: ${line}\n`);
    return 1;
  }
  return runTool("oxlint", [], { run: (_tool, _args, root) => seedBaseline(root, scripts.kept) });
}
