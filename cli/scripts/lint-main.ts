/**
 * `repo lint`: oxlint with the arguments given (the CSS paths left out; none but those: no oxlint), and the script
 * checks (magic literals, untested guards, Stylelint, Rust source rules) on the paths among them, or on the whole repo
 * with none, and with no argument at all clippy too; with `--fix` oxlint reruns until a pass rewrites no file it
 * lints, and Stylelint fixes the stylesheets before it reports.
 * By default the hits are gated on `.repo/lint-baseline.json` as `repo precommit` gates them: only the hits of a file
 * and rule over its entry print, with the line that says by how many, and fail; the rest are counted in one line.
 * `--all` prints every hit, oxlint's text then the script lines, and fails on one; a machine `--format` prints
 * oxlint's alone. Lint never writes the baseline: `--baseline` alone lowers and seeds it from oxlint's and the script
 * checks' hits.
 * The script checks load typescript and run while oxlint works (after it, with `--fix`), so the whole repo takes
 * about as long as the slower of the two.
 */
import fs from "node:fs";
import path from "node:path";

import { CSS_SOURCE } from "../css/stylelint.constants.ts";
import { runGit } from "../sync/standards.ts";
import { fixPasses } from "./fix-passes.ts";
import {
  countsOf,
  type Diagnostic,
  type Excess,
  gate,
  lintReport,
  readBaseline,
  seedBaseline,
} from "./lint-baseline.ts";
import { outsideOver, overOutput } from "./lint-gate.ts";
import {
  ALL_FLAG,
  DEFAULT_FORMAT,
  FIX_FLAG,
  LONG_FORMAT_FLAG,
  LONG_FORMAT_PREFIX,
  SHORT_FORMAT_FLAG,
} from "./lint-main.constants.ts";
import { captureTool, lint, runTool, type Tool } from "./lint.ts";
import { LINTABLE } from "./lintable.constants.ts";

/** Whether `a` is a flag that takes the format as its next argument. */
function isFormatFlag(a: string | undefined): boolean {
  return a === SHORT_FORMAT_FLAG || a === LONG_FORMAT_FLAG;
}

/** Whether a format flag's value is not the default text one. */
function isMachine(value: string | undefined): boolean {
  return value !== undefined && value !== DEFAULT_FORMAT;
}

/** Whether `argv` asks oxlint for a machine format (`-f json`, `--format json`, `--format=json`). */
function machineFormat(argv: readonly string[]): boolean {
  for (const [at, arg] of argv.entries()) {
    if (isFormatFlag(arg)) return isMachine(argv[at + 1]);

    if (arg.startsWith(LONG_FORMAT_PREFIX)) return isMachine(arg.slice(LONG_FORMAT_PREFIX.length));
  }

  return false;
}

/** The files git lists (tracked, or untracked and not ignored) under the paths of `args`, the whole repo with none. */
function listedFiles(root: string, args: readonly string[]): string[] {
  const paths = args.filter((arg) => !arg.startsWith("-") && fs.existsSync(path.resolve(root, arg)));
  const listed = runGit(root, ["ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", ...paths]);

  return listed.status === 0 ? listed.stdout.split("\0").filter(Boolean) : [];
}

/** The lintable files of `listedFiles`. */
function lintedFiles(root: string, args: readonly string[]): string[] {
  return listedFiles(root, args).filter((rel) => LINTABLE.test(rel));
}

/** oxlint's `--fix` in `root` rerun until a pass rewrites none of the files it lints; the last pass printed. */
async function fixedOxlint(tool: Tool, args: string[], root: string): Promise<number> {
  const last = await fixPasses(root, lintedFiles(root, args), async () => await captureTool(tool, args, { root }));
  process.stdout.write(last.stdout);
  process.stderr.write(last.stderr);

  return last.code;
}

/** The CSS paths of `named`, and whether they were all it named, when oxlint does not run. */
function cssOf(named: readonly string[]) {
  const css = named.filter((arg) => CSS_SOURCE.test(arg));

  return { css, only: css.length > 0 && css.length === named.length };
}

/** oxlint with `argv` less the CSS paths of `named`; when those were all it named, no oxlint and exit 0. */
function oxlintOf(argv: readonly string[], named: readonly string[]): Promise<number> {
  const { css, only } = cssOf(named);

  if (only) return Promise.resolve(0);

  const args = argv.filter((arg) => !css.includes(arg));

  return args.includes(FIX_FLAG) ? runTool("oxlint", args, { run: fixedOxlint }) : lint(args);
}

/** What one `repo lint` run lints: oxlint's arguments, the paths among them, and whether it fixes first. */
type LintRun = { argv: string[]; named: string[]; fix: boolean };

/** The arguments that name an existing file or directory, and whether `--fix` is among them. */
function lintRun(argv: string[]): LintRun {
  return {
    argv,
    fix: argv.includes(FIX_FLAG),
    named: argv.filter((arg) => fs.existsSync(path.resolve(process.cwd(), arg))),
  };
}

/** The script hits of `run`, after its oxlint fix when it fixes; clippy runs for a lint of no arguments only. */
async function scriptsOf(run: LintRun) {
  const { scriptLintAt } = await import("../script-diagnostics.ts");
  const scope = { clippy: run.argv.length === 0, fix: run.fix, paths: run.named.length === 0 ? null : run.named };

  return await scriptLintAt(process.cwd(), scope);
}

/**
 * `--all`: oxlint with `argv` and, while it runs (after it, with `--fix`), the script hits no `lint.skip` entry turns
 * off. Each hit is printed once oxlint is done, and one hit or problem fails the run.
 */
async function everyHit(run: LintRun): Promise<number> {
  // Without --fix the script checks read no file oxlint writes, so they run while it works.
  const oxlint = oxlintOf(run.argv, run.named);
  const fixed = run.fix ? await oxlint : null;
  const found = await scriptsOf(run);
  const code = fixed ?? (await oxlint);

  for (const { line } of found.kept) process.stdout.write(`${line}\n`);

  for (const line of found.problems) process.stderr.write(`repo lint: ${line}\n`);

  return code === 0 && found.kept.length + found.problems.length > 0 ? 1 : code;
}

/** Whether `argv[at]` asks for the default text format: `--format=default`, or a format flag or its value. */
function isTextFormat(argv: readonly string[], at: number): boolean {
  const [prev, arg, next] = [argv[at - 1], argv[at], argv[at + 1]];

  if (arg === `${LONG_FORMAT_PREFIX}${DEFAULT_FORMAT}`) return true;

  return (isFormatFlag(arg) && next === DEFAULT_FORMAT) || (arg === DEFAULT_FORMAT && isFormatFlag(prev));
}

/** The arguments of the json report the gate reads: no CSS path, no `--fix`, no text format flag. */
function reportArgs(run: LintRun, css: readonly string[]): string[] {
  return run.argv.filter((arg, at) => !css.includes(arg) && arg !== FIX_FLAG && !isTextFormat(run.argv, at));
}

/** oxlint's report on `run` in `root`, after its fix passes (which print nothing) when it fixes; none for CSS alone. */
async function oxlintHits(root: string, run: LintRun) {
  const { css, only } = cssOf(run.named);

  if (only) return { ok: true as const, value: [] };
  const args = reportArgs(run, css);

  if (run.fix) {
    const fixArgs = [...args, FIX_FLAG];
    await fixPasses(root, lintedFiles(root, args), async () => await captureTool("oxlint", fixArgs, { root }));
  }

  return await lintReport(root, args);
}

/** `repo lint`'s count of the hits the baseline allows. */
function withinLine(count: number): string {
  if (count === 0) return "repo lint: no hits\n";

  const hits = `${count.toLocaleString("en-US")} ${count === 1 ? "hit" : "hits"}`;

  return `repo lint: ${hits} within the baseline; --all prints them\n`;
}

/** Prints what `over` holds of `hits` and how to fix it, or else one line that counts `hits`; the exit code. */
function verdict(over: readonly Excess[], hits: readonly Diagnostic[]): number {
  if (over.length === 0) {
    process.stdout.write(withinLine(hits.length));

    return 0;
  }

  const output = overOutput("lint", over, hits);

  for (const line of output.hits) process.stdout.write(line);

  for (const line of output.fixes) process.stderr.write(line);

  return 1;
}

/**
 * The baseline gate of `run` in `root`, as `repo precommit`'s lint step gates: oxlint's report and the script hits,
 * the hits of each file and rule over its entry printed with what to do, or one line that counts the rest. A file
 * outside the paths given counts too, as a guard a test among them re-checked. The baseline is never written.
 */
async function gatedAt(root: string, run: LintRun): Promise<number> {
  const baseline = readBaseline(root);
  // Without --fix the script checks read no file oxlint writes, so they run while it works.
  const oxlint = oxlintHits(root, run);
  const fixed = run.fix ? await oxlint : null;
  const scripts = await scriptsOf(run);
  const report = fixed ?? (await oxlint);

  if (!report.ok || !baseline.ok || scripts.problems.length > 0) {
    const errors = [report, baseline].flatMap((read) => (read.ok ? [] : read.error));

    for (const line of [...errors, ...scripts.problems]) process.stderr.write(`repo lint: ${line}\n`);

    return 1;
  }

  const hits: Diagnostic[] = [...report.value, ...scripts.kept];
  const linted = run.named.length === 0 ? [...new Set(hits.map((d) => d.file))] : listedFiles(root, run.named);
  const over = [...gate(baseline.value, countsOf(hits), linted).over, ...outsideOver(baseline.value, hits, linted)];

  return verdict(over, hits);
}

/**
 * `repo lint` short of `--baseline`: every hit with `--all`, oxlint's alone with a machine format, else the baseline
 * gate, once the config loads with the standards pack on and sync has written oxlint's config.
 */
function lintAndScripts(argv: string[]): Promise<number> {
  const all = argv.includes(ALL_FLAG);
  const run = lintRun(argv.filter((arg) => arg !== ALL_FLAG));

  if (machineFormat(run.argv)) return oxlintOf(run.argv, run.named);

  if (all) return everyHit(run);

  return runTool("oxlint", run.argv, { run: (_tool, _args, root) => gatedAt(root, run) });
}

export async function lintMain(argv: string[]): Promise<number> {
  if (!argv.includes("--baseline")) return lintAndScripts(argv);

  if (argv.length > 1) {
    process.stderr.write("repo lint: --baseline takes no other arguments; it lints the whole repo\n");

    return 1;
  }

  const { checkScriptsAt } = await import("../script-diagnostics.ts");
  const scripts = await checkScriptsAt(process.cwd());

  if (scripts.problems.length > 0) {
    for (const line of scripts.problems) process.stderr.write(`repo lint: ${line}\n`);

    return 1;
  }

  return runTool("oxlint", [], { run: (_tool, _args, root) => seedBaseline(root, scripts.kept) });
}
