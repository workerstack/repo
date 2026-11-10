/** Where Rust sources and their manifest are looked for. */

/** A Rust source file. */
export const RUST_SOURCE: RegExp = /\.rs$/;
/** The dir names whose files are never linted: copies of other code, and build output. */
export const EXCLUDED_DIRS: readonly string[] = ["fixtures", "target"];
/** The manifest whose presence at the root makes the repo a Rust one. */
export const CARGO_MANIFEST: string = "Cargo.toml";
