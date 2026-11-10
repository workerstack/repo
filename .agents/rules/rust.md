---
trigger: glob
globs: '**/*.rs'
---
Format with rustfmt at its defaults; `bun repo fmt` runs `cargo fmt --all`, and `bun repo fmt --check` fails on a diff.

Clippy runs with `clippy::pedantic` and warnings denied: every hit fails `bun repo check` unless the baseline counts it or `lint.skip` turns it off with a reason. Lint levels live on the command line only. Never write `#[allow]`, `#[expect]`, `#[warn]`, `#[deny]` or `#[forbid]` in code, in an inner `#![...]` or inside `cfg_attr`; `bun repo check` fails each one. To accept a hit, add a `lint.skip` entry with a `clippy/<lint_name>` or `rust/<lint_name>` rule and the reason.

Do not call `unwrap` or `expect` outside tests. Return the error, or handle it. Code under `#[cfg(test)]` and `#[test]` functions may use both.

Libraries define their errors with `thiserror`. Binaries use `anyhow` and add context at each fallible call.

Every `unsafe` block or function carries a `// SAFETY:` comment that says why the call upholds the contract. Prefer safe code.

Write comments in the line form only: `//`, `///` and `//!`. Never use `/* */`, not even for docs.

Keep a file to 200 lines of code, comments and blank lines not counted. Clippy holds a function to 30 lines and 3 arguments.

Export only what the crate needs. Use `pub(crate)` or no `pub` for the rest; `unreachable_pub` reports a `pub` item nothing outside the crate can reach.

Commit `Cargo.lock`. Cargo runs with `--locked`, so a missing, stale or untracked lock fails `bun repo check`; fix it with `cargo generate-lockfile` or `cargo update --workspace`, then commit it.

A crate either sets `publish = false` or has `license`, `description`, `repository` and `rust-version`; `bun repo check` fails a publishable crate that lacks one.

Dependencies pass cargo-deny under the generated `deny.toml` (permissive licenses only, no unknown registries or git sources, no wildcard versions) and cargo-shear (no unused dependency; a deliberate one goes under `[package.metadata.cargo-shear] ignored`). cargo-deny 0.20.2 and cargo-shear 1.14.0 must be installed: `cargo install --locked cargo-deny@0.20.2 cargo-shear@1.14.0`.

Run tests with cargo-nextest, not `cargo test`; `bun repo ci` runs `cargo nextest run`, and `cargo test --doc` too when a target has doctests, since nextest does not run those. cargo-nextest 0.9.151 and cargo-llvm-cov 0.9.1 must be installed: `cargo install --locked cargo-nextest@0.9.151 cargo-llvm-cov@0.9.1`.

Coverage runs through `cargo llvm-cov nextest` and is checked per `.rs` file against `coverage.floors` on lines, functions and regions. Never write a floor by hand: `bun repo coverage` writes a row for each file and only raises it. Pass `--no-coverage` to skip the measurement.

`bun repo release api` checks each workspace crate that publishes to crates.io with `cargo semver-checks check-release` against the highest non-yanked crates.io version at or below the checkout's. A crate crates.io does not have yet is skipped. When the checkout version is above that baseline, the bump decides; otherwise the crate's commits since the baseline was published do: from 1.0 a breaking `!` commit allows a major and `feat` a minor, before 1.0 a breaking commit allows a minor, and anything else allows a patch. To ship a break, bump the version or mark a commit under that crate breaking with `!`. cargo-semver-checks 0.51.0 must be installed: `cargo install --locked cargo-semver-checks@0.51.0`. The generated CI runs it in a `semver` job.
