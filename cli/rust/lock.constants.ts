/** The texts of the lock faults that `cargo clippy --locked` meets. */

/** What a repo with a root Cargo.toml and no Cargo.lock is told. */
export const MISSING_LOCK: string = "Cargo.lock is missing; run `cargo generate-lockfile` and commit it";

/** What a repo whose Cargo.lock no longer matches its Cargo.toml is told. */
export const STALE_LOCK: string =
  "Cargo.lock is out of date with Cargo.toml; run `cargo update --workspace` and commit it";

/** The words in cargo's stderr (exit 101) that say the lock needs an update while `--locked` was passed. */
export const STALE_MARKER: string = "--locked was passed";
