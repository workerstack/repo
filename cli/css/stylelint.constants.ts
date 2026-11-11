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
/** The dir name whose files are copies of other code, never linted. */
export const FIXTURES_DIR = "fixtures";
/** Where the runner's arguments start in its argv, after bun and the script. */
export const ARGS_START = 2;
/** The prefix of a Stylelint rule's name in `lint.skip` and, through `codeOf`, in a diagnostic. */
export const STYLELINT_PREFIX = "stylelint/";
/** A Stylelint rule as `lint.skip` takes it: lowercase words, dashes and a plugin's slash. */
export const STYLELINT_RULE: RegExp = /^stylelint\/[a-z][a-z/-]*$/;
/** The start of the problem line when the runner fails or prints what is not its results. */
export const CANNOT_RUN = "stylelint could not run";
