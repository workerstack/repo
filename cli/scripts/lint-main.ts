/**
 * `repo lint`: oxlint with the arguments given, then the script checks (magic literals, untested guards, Rust source
 * rules) on the paths among them, or on the whole repo with none, and with no argument at all clippy too. Plain lint
 * loads typescript for those checks, so one file takes about 0.6s and the whole repo about 2.5s more than oxlint
 * alone; a machine `--format` skips them. `--baseline` alone lowers and seeds the baseline from oxlint's and the script
 * checks' hits.
 */
import fs from "node:fs";
import path from "node:path";
import { lint, runTool } from "./lint.ts";
import { DEFAULT_FORMAT, LONG_FORMAT_FLAG, LONG_FORMAT_PREFIX, SHORT_FORMAT_FLAG } from "./lint-main.constants.ts";

/** Whether a format flag's value is not the default text one. */
const isMachine = (value: string | undefined): boolean => value !== undefined && value !== DEFAULT_FORMAT;

/** Whether `argv` asks oxlint for a machine format (`-f json`, `--format json`, `--format=json`). */
function machineFormat(argv: readonly string[]): boolean {
  for (const [at, arg] of argv.entries()) {
    if (arg === SHORT_FORMAT_FLAG || arg === LONG_FORMAT_FLAG) return isMachine(argv[at + 1]);
    if (arg.startsWith(LONG_FORMAT_PREFIX)) return isMachine(arg.slice(LONG_FORMAT_PREFIX.length));
  }
  return false;
}

/**
 * oxlint with `argv`, then the script hits no `lint.skip` entry turns off: of the arguments that name an existing file
 * or directory, or the whole repo when none does; clippy runs for a lint of no arguments only. Each hit is printed and
 * one hit or problem fails the run.
 */
async function lintAndScripts(argv: string[]): Promise<number> {
  const code = await lint(argv);
  if (machineFormat(argv)) return code;
  const { scriptLintAt } = await import("../script-diagnostics.ts");
  const named = argv.filter((arg) => fs.existsSync(path.resolve(process.cwd(), arg)));
  const scope = { paths: named.length === 0 ? null : named, clippy: argv.length === 0 };
  const found = await scriptLintAt(process.cwd(), scope);
  for (const line of found.lines) process.stdout.write(`${line}\n`);
  for (const line of found.problems) process.stderr.write(`repo lint: ${line}\n`);
  return code === 0 && found.lines.length + found.problems.length > 0 ? 1 : code;
}

export async function lintMain(argv: string[]): Promise<number> {
  if (!argv.includes("--baseline")) return lintAndScripts(argv);
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
