/**
 * `repo lint`: oxlint with the arguments given, or with `--baseline` alone, the baseline lowered and seeded from
 * oxlint's and the script checks' hits. The baseline and the script checks load only for `--baseline`, so a lint of
 * paths never loads typescript.
 */
import { lint, runTool } from "./lint.ts";

export async function lintMain(argv: string[]): Promise<number> {
  if (!argv.includes("--baseline")) return lint(argv);
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
