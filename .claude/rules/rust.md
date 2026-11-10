---
paths:
  - '**/*.rs'
---
Format with rustfmt at its defaults; `bun repo fmt` runs `cargo fmt --all`, and `bun repo fmt --check` fails on a diff.

Clippy runs with `clippy::pedantic` and warnings denied: every hit fails `bun repo check` unless the baseline counts it or `lint.skip` turns it off with a reason. Lint levels live on the command line only. Never write `#[allow]`, `#[expect]`, `#[warn]`, `#[deny]` or `#[forbid]` in code, in an inner `#![...]` or inside `cfg_attr`; `bun repo check` fails each one. To accept a hit, add a `lint.skip` entry with a `clippy/<lint_name>` or `rust/<lint_name>` rule and the reason.

Do not call `unwrap` or `expect` outside tests. Return the error, or handle it. Code under `#[cfg(test)]` and `#[test]` functions may use both.

Libraries define their errors with `thiserror`. Binaries use `anyhow` and add context at each fallible call.

Every `unsafe` block or function carries a `// SAFETY:` comment that says why the call upholds the contract. Prefer safe code.

Write comments in the line form only: `//`, `///` and `//!`. Never use `/* */`, not even for docs.

Keep a file to 200 lines of code, comments and blank lines not counted. Clippy holds a function to 30 lines and 3 arguments.

Export only what the crate needs. Use `pub(crate)` or no `pub` for the rest; `unreachable_pub` reports a `pub` item nothing outside the crate can reach.
