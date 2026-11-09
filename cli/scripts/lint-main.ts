/**
 * `repo lint`: oxlint with the arguments given, or with `--baseline` alone, the baseline lowered and seeded from
 * oxlint's and the magic literal hits. The baseline and the magic check load only for `--baseline`, so a lint of
 * paths never loads typescript.
 */
import { lint, runTool } from "./lint.ts";

export async function lintMain(argv: string[]): Promise<number> {
  if (!argv.includes("--baseline")) return lint(argv);
  if (argv.length > 1) {
    process.stderr.write("repo lint: --baseline takes no other arguments; it lints the whole repo\n");
    return 1;
  }
  const [{ seedBaseline }, { checkMagicAt }] = await Promise.all([
    import("./lint-baseline.ts"),
    import("../check-magic.ts"),
  ]);
  const magic = await checkMagicAt(process.cwd());
  if (magic.problems.length > 0) {
    for (const line of magic.problems) process.stderr.write(`repo lint: ${line}\n`);
    return 1;
  }
  return runTool("oxlint", [], { run: (_tool, _args, root) => seedBaseline(root, magic.kept) });
}
