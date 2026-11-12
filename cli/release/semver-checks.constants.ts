/** The words and patterns the semver check reads and says. */

/** Cargo arguments before the crate: the lock is kept, and the subcommand runs against one manifest. */
export const CHECK_ARGS: readonly string[] = ["--locked", "semver-checks", "check-release"];

/** The exit code cargo-semver-checks gives for a breaking change. */
export const EXIT_BREAKING: number = 100;

/** A lint's header in the tool's stderr. */
export const FAILURE_HEADER: RegExp = /^--- failure (?<lint>\S+?): (?<what>.*?) ---$/;

/** The line that opens a lint's items. */
export const FAILED_IN: string = "Failed in:";

/** The line that ends the last lint's items, naming the release the changes need. */
export const SUMMARY: RegExp = /^Summary semver requires new (?<level>major|minor) version/;

/** The location the tool appends to an item. */
export const ITEM_LOCATION: RegExp = /,? previously in file .*$/;

/** The Cargo.toml in a crate's workspace root. */
export const MANIFEST_FILE: string = "Cargo.toml";

/** The index of the last element, for `.at`. */
export const LAST: number = -1;

/** What a failure line calls the release when the tool's summary did not say which. */
export const UNSAID_LEVEL: string = "newer";

/** The commit type that asks for a minor release from 1.0. */
export const FEAT_TYPE: string = "feat";
