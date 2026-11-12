import fs from "node:fs";
import path from "node:path";

import { expect, it } from "vitest";

import { useTempDirs } from "../__fixtures__/temp-dirs.ts";
import { CLIPPY_TOML } from "../sync/rust.constants.ts";
import { rustHitsAt } from "./rust-hits.ts";

/** A cold cargo build of a tiny crate, with room for a busy CI runner. */
const CARGO_MS = 300_000;
const FIXTURES = path.join(import.meta.dirname, "__fixtures__");

const { tempDir } = useTempDirs("workerstack-rust-crate-");

/**
 * A fresh copy of a fixture crate with the generated clippy.toml at its root; clippy.toml edits do not invalidate
 * cargo's cache, so each run builds anew.
 */
function crate(name: string): string {
  const root = tempDir();
  fs.cpSync(path.join(FIXTURES, name), root, { recursive: true });
  fs.writeFileSync(path.join(root, "clippy.toml"), CLIPPY_TOML);

  return root;
}

it(
  "runs the real clippy: unwrap in library code is a hit, unwrap in #[cfg(test)] is not",
  { timeout: CARGO_MS },
  () => {
    const result = rustHitsAt(crate("lib-crate"), ["src/lib.rs"], { clippy: true });
    const unwraps = result.ok ? result.value.filter((d) => d.rule === "clippy(unwrap_used)") : [];
    expect(unwraps).toStrictEqual([
      {
        file: "src/lib.rs",
        line: "src/lib.rs:2:5: error clippy(unwrap_used): used `unwrap()` on a `Result` value",
        rule: "clippy(unwrap_used)",
      },
    ]);
  },
);

it("reads the root clippy.toml for a member crate in a subdir", { timeout: CARGO_MS }, () => {
  const result = rustHitsAt(crate("workspace-crate"), ["members/foo/src/lib.rs"], { clippy: true });
  const lines = result.ok ? result.value.map((d) => d.line) : [];
  // The threshold of 3 reaches the member, and allow-unwrap-in-tests spares its test module.
  expect(lines.filter((line) => line.includes("too_many_arguments"))).toStrictEqual([
    "members/foo/src/lib.rs:1:1: error clippy(too_many_arguments): this function has too many arguments (4/3)",
  ]);
  expect(lines.filter((line) => line.includes("unwrap_used"))).toStrictEqual([]);
});

it("makes a crate that does not compile a problem, never a hit", { timeout: CARGO_MS }, () => {
  const root = crate("lib-crate");
  fs.writeFileSync(path.join(root, "src/lib.rs"), 'pub fn f() -> u8 { "a" }\n');
  const result = rustHitsAt(root, ["src/lib.rs"], { clippy: true });
  expect(result).toStrictEqual({ error: ["cargo clippy: error[E0308]: mismatched types (src/lib.rs:1)"], ok: false });
});

it("names the stale lock when Cargo.toml gains a dependency the lock does not list", { timeout: CARGO_MS }, () => {
  const root = crate("lib-crate");
  fs.mkdirSync(path.join(root, "dep/src"), { recursive: true });
  fs.writeFileSync(path.join(root, "dep/Cargo.toml"), '[package]\nname = "dep"\nversion = "0.1.0"\nedition = "2021"\n');
  fs.writeFileSync(path.join(root, "dep/src/lib.rs"), "");
  const manifest = path.join(root, "Cargo.toml");
  fs.appendFileSync(manifest, '\n[dependencies]\ndep = { path = "dep" }\n');
  expect(rustHitsAt(root, ["src/lib.rs"], { clippy: true })).toStrictEqual({
    error: ["Cargo.lock is out of date with Cargo.toml; run `cargo update --workspace` and commit it"],
    ok: false,
  });
});
