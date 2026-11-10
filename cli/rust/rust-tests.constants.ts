/** The cargo arguments of the Rust tests without coverage: nextest, locked, over the workspace; a repo with no tests warns. */
export const NEXTEST_ARGS: readonly string[] = ["nextest", "run", "--locked", "--workspace", "--no-tests=warn"];
/** The cargo arguments that list the workspace crates and their targets as JSON, resolved against the lock. */
export const METADATA_ARGS: readonly string[] = ["metadata", "--no-deps", "--format-version", "1", "--locked"];
/** The cargo arguments of the doctests of every workspace crate. */
export const DOCTEST_ARGS: readonly string[] = ["test", "--doc", "--locked", "--workspace"];
/** The passed count in nextest's summary, as in `1 test run: 1 passed, 0 skipped`. */
export const NEXTEST_PASSED: RegExp = /\d+ tests? run: (\d+) passed/;
/** The passed count of one crate's doctests, as in `test result: ok. 1 passed; 0 failed`. */
export const DOCTEST_PASSED: RegExp = /test result: ok\. (\d+) passed/g;
/** The label of a gate whose tests, doctests or floors failed; the output under it says which. */
export const FAILED_LABEL: string = "rust tests failed";
/** The manifest whose presence in the root turns the Rust tests gate on. */
export const RUST_MANIFEST: string = "Cargo.toml";
