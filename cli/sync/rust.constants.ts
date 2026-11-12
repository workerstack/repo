/** The text of the Rust configs `repo sync` writes for a repo with a root Cargo.toml. */

/** The manifest whose presence at the root makes the repo a Rust one. */
export const CARGO_PATH: string = "Cargo.toml";

/** The Rust release the repo is built and linted with; a full X.Y.Z pins exactly, and bumping it is a repo release. */
const RUST_CHANNEL: string = "1.99.1";

/** Where rustup reads the toolchain. */
export const TOOLCHAIN_PATH: string = "rust-toolchain.toml";

/** Where rustfmt reads its options. */
export const RUSTFMT_PATH: string = "rustfmt.toml";

/** Where clippy reads its options; cargo finds it from the workspace root for every member crate. */
export const CLIPPY_PATH: string = "clippy.toml";

/** The pinned toolchain: the compiler with only the formatter and the linter. */
export const TOOLCHAIN_TOML: string =
  `[toolchain]\nchannel = "${RUST_CHANNEL}"\n` +
  'components = ["rustfmt", "clippy", "llvm-tools-preview"]\nprofile = "minimal"\n';

/** rustfmt's defaults, so the file only marks the root. */
export const RUSTFMT_TOML: string = `# rustfmt's defaults apply.\n`;

/** Tests may unwrap and expect; function size and arity match the TypeScript limits. */
export const CLIPPY_TOML: string =
  "allow-unwrap-in-tests = true\nallow-expect-in-tests = true\n" +
  "too-many-lines-threshold = 30\ntoo-many-arguments-threshold = 3\n";

/** Where cargo-deny reads its policy; it finds it at the workspace root. */
export const DENY_PATH: string = "deny.toml";

/** Cargo's build dir, which git must ignore wherever the toolchain pin is written. */
export const CARGO_TARGET_DIR: string = "target/";

/** Every feature of every crate is checked, so a dependency behind a feature cannot slip past the policy. */
const DENY_GRAPH: string = "[graph]\nall-features = true\n";

/** Unmaintained and unsound crates fail in the whole tree, direct or transitive, and a yanked release is refused. */
const DENY_ADVISORIES: string = '[advisories]\nunmaintained = "all"\nunsound = "all"\nyanked = "deny"\n';

/** The permissive licenses a dependency may carry; anything else, copyleft included, needs a repo decision. */
const DENY_LICENSES: string = `[licenses]
confidence-threshold = 0.93
allow = [
  "0BSD",
  "Apache-2.0",
  "Apache-2.0 WITH LLVM-exception",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "BSL-1.0",
  "CC0-1.0",
  "ISC",
  "MIT",
  "MIT-0",
  "Unicode-3.0",
  "Unlicense",
  "Zlib",
]
unused-allowed-license = "allow"
`;

/** The repo's own unpublished crates carry no license, so they need none. */
const DENY_PRIVATE: string = "[licenses.private]\nignore = true\n";

/**
 * A second version of a crate only warns, since the tree rarely controls it; a wildcard requirement is refused
 * unless it is a path dependency inside the workspace.
 */
const DENY_BANS: string = '[bans]\nmultiple-versions = "warn"\nwildcards = "deny"\nallow-wildcard-paths = true\n';

/**
 * Only crates.io is allowed, which cargo-deny does by default when `allow-registry` is unset; a git source is
 * refused.
 */
const DENY_SOURCES: string = '[sources]\nunknown-registry = "deny"\nunknown-git = "deny"\n';

/** The cargo-deny policy: advisories, licenses, bans and sources, each section proven against a real lockfile. */
export const DENY_TOML: string = `${DENY_GRAPH}
${DENY_ADVISORIES}
${DENY_LICENSES}
${DENY_PRIVATE}
${DENY_BANS}
${DENY_SOURCES}`;
