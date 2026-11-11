/** The names and texts of the Stylelint run over a checkout's CSS. */

/** The Tailwind v4 pack: its at-rule, type and property defs, which the config spreads its own beside. */
export const TAILWIND_PACK = "@dreamsicle.io/stylelint-config-tailwindcss";
/** The packs the config extends by name, resolved from this package's dir: the standard rules, Tailwind v4, order. */
export const EXTENDS: readonly string[] = ["stylelint-config-standard", TAILWIND_PACK, "stylelint-config-recess-order"];
/** The v4 at-rules the Tailwind pack has no prelude def for; each takes a quoted path or package name. */
export const STRING_AT_RULES: readonly string[] = ["config", "plugin"];
export const STRING_PRELUDE = "<string>";
/** The runner's first argument when it is to fix the files. */
export const FIX_FLAG = "--fix";
/** A stylesheet Stylelint lints. */
export const CSS_SOURCE: RegExp = /\.css$/;
/** The pathspec git lists stylesheets at any depth by. */
export const CSS_PATHSPEC = "*.css";
/** The start of the dependency dir's name, kept apart so no path here spells it whole. */
const DEPENDENCY_PREFIX = "node";
/** The pathspec that leaves out a dependency dir at any depth, so git never walks or lists it. */
export const DEPENDENCY_EXCLUDE: string = `:(exclude,glob)**/${DEPENDENCY_PREFIX}_modules/**`;
/** The dir name whose files are copies of other code, never linted. */
export const FIXTURES_DIR = "fixtures";
/** Where the runner's arguments start in the eval child's argv: after bun alone, the eval code is not in it. */
const ARGS_START = 1;
/**
 * The code the child evaluates: imports `main` from the module URL its first argument gives, runs it on the rest with
 * the child's stdout and stderr, and exits with the code it returns.
 */
export const RUNNER_EVAL: string = `const [url, ...args] = process.argv.slice(${ARGS_START});
const { main } = await import(url);
process.exitCode = await main(args, (text) => process.stdout.write(text), (text) => process.stderr.write(text));
`;
/** The prefix of a Stylelint rule's name in `lint.skip` and, through `codeOf`, in a diagnostic. */
export const STYLELINT_PREFIX = "stylelint/";
/** A Stylelint rule as `lint.skip` takes it: lowercase words, dashes and a plugin's slash. */
export const STYLELINT_RULE: RegExp = /^stylelint\/[a-z][a-z/-]*$/;
/** The start of the problem line when the runner fails or prints what is not its results. */
export const CANNOT_RUN = "stylelint could not run";
