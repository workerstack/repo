/** The cargo call and message text of the clippy run. */

/** The program that runs clippy. */
export const CARGO: string = "cargo";
/** The cargo arguments: clippy at the repo's levels as `-W` flags, so the build completes and reports every hit. */
export const CLIPPY_ARGS: readonly string[] = [
  ...["clippy", "--all-targets", "--all-features", "--message-format=json", "--"],
  ...["-W", "clippy::pedantic", "-W", "clippy::unwrap_used", "-W", "clippy::expect_used"],
  ...["-W", "clippy::undocumented_unsafe_blocks", "-W", "clippy::unnecessary_safety_comment"],
  ...["-W", "unreachable_pub"],
];
/** What a repo with a Cargo.toml and no cargo is told. */
export const MISSING_CARGO: string =
  "Cargo.toml is here but cargo is not on PATH; install rustup from https://rustup.rs";
/** The spawn error code of a program that is not on PATH. */
export const NOT_FOUND: string = "ENOENT";
/** The most stdout a clippy run may print, in bytes. */
export const MAX_OUTPUT: number = 1024 * 1024 * 1024;
/** The `reason` of a line that carries a diagnostic. */
export const COMPILER_MESSAGE: string = "compiler-message";
/** The prefix of a clippy lint's code. */
export const CLIPPY_PREFIX: string = "clippy::";
/** A rustc error code, such as `E0308`, as opposed to a lint's name. */
export const ERROR_CODE: RegExp = /^E\d{4}$/;
/** The longest unreadable line a problem quotes, in characters. */
export const QUOTE_LIMIT: number = 80;
/** The level of a message that fails the build. */
export const ERROR_LEVEL: string = "error";
/** The level of a lint at its default or `-W` level. */
export const WARNING_LEVEL: string = "warning";
/** A `./` that starts a path. */
export const DOT_SLASH: RegExp = /^\.\//;
