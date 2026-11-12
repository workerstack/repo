/**
 * The checks `repo check`, `repo turn`, `repo lint --baseline` and `repo lint` (on the paths given, or the whole repo)
 * run beside oxlint as scripts on the TypeScript compiler API (and jscpd, for `repo/duplicate-code`), by the names
 * `lint.skip` takes. Kept apart from the checks so the oxlint config can accept the names without loading typescript.
 */
export const MAGIC_NUMBER = "repo/magic-number";
export const MAGIC_STRING = "repo/magic-string";
export const MAGIC_REGEX = "repo/magic-regex";
export const GUARD_REJECTS = "repo/guard-rejects";

/** A clone of at least 50 tokens and 5 lines, found by jscpd. */
export const DUPLICATE_CODE = "repo/duplicate-code";

/** The Rust source rules, which run only in a repo with a root Cargo.toml. */
const RUST_LINT_ATTRIBUTE = "repo/rust-lint-attribute";
const RUST_BLOCK_COMMENT = "repo/rust-block-comment";
const RUST_MAX_LINES = "repo/rust-max-lines";
const RUST_SOURCE_RULES: readonly string[] = [RUST_LINT_ATTRIBUTE, RUST_BLOCK_COMMENT, RUST_MAX_LINES];

export const SCRIPT_RULES: readonly string[] = [
  MAGIC_NUMBER,
  MAGIC_STRING,
  MAGIC_REGEX,
  GUARD_REJECTS,
  DUPLICATE_CODE,
  ...RUST_SOURCE_RULES,
];

/** A clippy or rustc lint by its snake_case name, as `clippy/unwrap_used` or `rust/unreachable_pub`. */
const RUST_LINT = /^(clippy|rust)\/[a-z][a-z0-9_]*$/;

/** Whether `rule` names a clippy or rustc lint; such a skip is valid only in a repo with a root Cargo.toml. */
function isRustLint(rule: string): boolean {
  return RUST_LINT.test(rule);
}

/** Whether `rule` is a Rust rule: one of the three source rules or a clippy or rustc lint. */
export function isRustRule(rule: string): boolean {
  return RUST_SOURCE_RULES.includes(rule) || isRustLint(rule);
}

/** `repo/no-module-state` is reported as `repo(no-module-state)`. */
export function codeOf(rule: string): string {
  return rule.replace("/", "(").concat(")");
}
