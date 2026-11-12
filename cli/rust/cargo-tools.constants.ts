/** The pinned cargo tools and the text of their problems. */

/** A cargo subcommand repo pins: `cargo <tool>` runs the binary `cargo-<tool>` at exactly `version`. */
export type Pin = { tool: "deny" | "shear" | "nextest" | "llvm-cov" | "semver-checks" | "mutants"; version: string };

/** The cargo-deny release repo runs; bumping it is a repo release. */
export const DENY_PIN: Pin = { tool: "deny", version: "0.20.2" };

/** The cargo-shear release repo runs; bumping it is a repo release. */
export const SHEAR_PIN: Pin = { tool: "shear", version: "1.14.0" };

/** The cargo-nextest release repo runs; bumping it is a repo release. */
export const NEXTEST_PIN: Pin = { tool: "nextest", version: "0.9.151" };

/** The cargo-llvm-cov release repo runs; bumping it is a repo release. */
export const LLVM_COV_PIN: Pin = { tool: "llvm-cov", version: "0.9.1" };

/** The cargo-semver-checks release repo runs; bumping it is a repo release. */
export const SEMVER_CHECKS_PIN: Pin = { tool: "semver-checks", version: "0.51.0" };

/** The cargo-mutants release repo runs; bumping it is a repo release. */
export const CARGO_MUTANTS_PIN: Pin = { tool: "mutants", version: "27.1.0" };

/** The first `X.Y.Z` of a tool's `--version` output, as in `cargo-deny 0.20.2` or `Version: 1.14.0`. */
export const SEMVER: RegExp = /\d+\.\d+\.\d+/;

/** What cargo prints on stderr for a subcommand that is not installed. */
export const NO_SUCH_COMMAND: string = "no such command";

/** The longest unreadable text a problem quotes, in characters. */
export const QUOTE_LIMIT: number = 80;

/** The `severity` of a diagnostic that fails cargo-deny. */
export const DENY_ERROR: string = "error";

/** The `level` of a log line that fails cargo-deny. */
export const LOG_ERROR: string = "ERROR";

/** The `type` of a cargo-deny line that is a diagnostic. */
export const DIAGNOSTIC_TYPE: string = "diagnostic";

/** The `type` of a cargo-deny line that is a log message. */
export const LOG_TYPE: string = "log";

/** The start of the log message that says the advisory database could not be fetched. */
export const FETCH_FAILED: string = "failed to fetch advisory database";

/** The code of a shear finding for a dependency nothing uses. */
export const UNUSED_DEPENDENCY: string = "shear/unused_dependency";

/** What a person does about an unused dependency. */
export const UNUSED_HELP: string = "remove it or list it under [package.metadata.cargo-shear] ignored";

/** The highest shear exit code that still means it ran: 0 is clean and 1 is findings. */
export const SHEAR_MAX_FINDING_EXIT: number = 1;

/** The cargo-deny codes that say a crate has no license; the crate check already names such a workspace crate. */
export const UNLICENSED_CODES: readonly string[] = ["unlicensed", "no-license-field"];

/** The cargo-deny diagnostic codes of each section; a code in none of them prints with no section. */
const DENY_SECTIONS = {
  advisories: [
    "vulnerability",
    "notice",
    "unmaintained",
    "unsound",
    "yanked",
    "advisory-ignored",
    "yanked-ignored",
    "index-failure",
    "index-cache-load-failure",
    "advisory-not-detected",
    "yanked-not-detected",
    "unknown-advisory",
  ],
  bans: [
    "banned",
    "allowed",
    "not-allowed",
    "duplicate",
    "skipped",
    "wildcard",
    "unmatched-skip",
    "unnecessary-skip",
    "allowed-by-wrapper",
    "unmatched-wrapper",
    "skipped-by-root",
    "unmatched-skip-root",
    "build-script-not-allowed",
    "exact-features-mismatch",
    "feature-not-explicitly-allowed",
    "feature-banned",
    "unknown-feature",
    "default-feature-enabled",
    "path-bypassed",
    "path-bypassed-by-glob",
    "checksum-match",
    "checksum-mismatch",
    "denied-by-extension",
    "detected-executable",
    "detected-executable-script",
    "unable-to-check-path",
    "features-enabled",
    "unmatched-bypass",
    "unmatched-path-bypass",
    "unmatched-glob",
    "unused-wrapper",
    "workspace-duplicate",
    "unresolved-workspace-dependency",
    "unused-workspace-dependency",
    "non-root-path",
    "replaced-in-std",
    "unmatched-replacement-ignore",
  ],
  licenses: [
    "accepted",
    "rejected",
    "unlicensed",
    "skipped-private-workspace-crate",
    "license-not-encountered",
    "license-exception-not-encountered",
    "missing-clarification-file",
    "parse-error",
    "empty-license-field",
    "no-license-field",
    "gather-failure",
  ],
  sources: [
    "git-source-underspecified",
    "allowed-source",
    "allowed-by-organization",
    "source-not-allowed",
    "unmatched-source",
    "unmatched-organization",
  ],
} satisfies Readonly<Record<string, readonly string[]>>;

/** The cargo-deny section that reports `code`, or undefined when no section lists it. */
export function denySectionOf(code: string | undefined): string | undefined {
  return Object.entries(DENY_SECTIONS).find(([, codes]) => code !== undefined && codes.includes(code))?.[0];
}

/** One whitespace character, where the first word of a message ends. */
export const WHITESPACE: RegExp = /\s/;
