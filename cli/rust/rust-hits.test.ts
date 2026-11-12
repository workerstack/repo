import { execFileSync } from "node:child_process";
import path from "node:path";

import { expect, it } from "vitest";

import { useTempTree } from "../__fixtures__/temp-tree.ts";
import { cargoLock } from "./__fixtures__/cargo-lock.ts";
import type { CargoResult } from "./clippy.ts";
import { rustFiles, rustHitsAt } from "./rust-hits.ts";

const plant = useTempTree("workerstack-rust-hits-");

function git(root: string, ...args: string[]) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" });
}

function line(file: string, text: string, rule: string) {
  return JSON.stringify({
    message: {
      code: { code: rule },
      level: "warning",
      message: text,
      spans: [{ column_start: 27, file_name: file, is_primary: true, line_start: 3 }],
    },
    reason: "compiler-message",
  });
}

/** A runner whose clippy output is one lint at `src/lib.rs:3:27` and one in a file the caller did not list. */
function lints(): CargoResult {
  const stdout = [
    line("src/lib.rs", "used `unwrap()` on a `Result` value", "clippy::unwrap_used"),
    line("src/gone.rs", "elsewhere", "dead_code"),
  ].join("\n");

  return { missing: false, status: 0, stderr: "", stdout };
}

function never(): never {
  throw new Error("cargo ran");
}

function missing(): CargoResult {
  return { missing: true, status: 1, stderr: "", stdout: "" };
}

const USAGE = "#[allow(dead_code)]\n/* old */\npub fn f(s: &str) -> u8 { s.parse().unwrap() }\n";

it("lists the rust files git knows, tracked or not, outside fixtures and target dirs, sorted", () => {
  const root = plant({
    ".gitignore": "ignored.rs\n",
    "crates/foo/target/gen.rs": "",
    "src/a.rs": "",
    "src/ignored.rs": "",
    "src/lib.rs": "",
    "src/readme.md": "",
    "src/target.rs": "",
    "target/debug/build.rs": "",
    "tests/__fixtures__/x.rs": "",
  });

  git(root, "init", "-q");
  git(root, "add", "src/lib.rs");
  expect(rustFiles(root)).toStrictEqual({ ok: true, value: ["src/a.rs", "src/lib.rs", "src/target.rs"] });
});

it("says git failed when the root is not a checkout", () => {
  const listed = rustFiles(path.join(plant({ "a.rs": "" }), "missing"));
  expect(listed.ok).toBe(false);
  expect(!listed.ok && listed.error[0]).toMatch(/^git ls-files failed: /);
});

it("has no diagnostic without a root Cargo.toml", () => {
  const root = plant({ "src/lib.rs": USAGE });
  expect(rustHitsAt(root, ["src/lib.rs"], { clippy: true, run: lints })).toStrictEqual({ ok: true, value: [] });
});

it("prints the source rules in Usage's form, in file order, without compiling when clippy is off", () => {
  const root = plant({ "Cargo.lock": cargoLock("app"), "Cargo.toml": "", "src/lib.rs": USAGE });
  const text = "#[allow] sets a lint level in code; lint levels live on the command line, so fix the code";
  expect(rustHitsAt(root, ["src/lib.rs"], { clippy: false, run: never })).toStrictEqual({
    ok: true,
    value: [
      {
        file: "src/lib.rs",
        line: `src/lib.rs:1:1: error repo(rust-lint-attribute): ${text} or add a lint.skip entry with a reason`,
        rule: "repo(rust-lint-attribute)",
      },
      {
        file: "src/lib.rs",
        line:
          "src/lib.rs:2:1: error repo(rust-block-comment): Rust comments use the line form (//, ///, //!); " +
          "rewrite this /* */ as // lines",
        rule: "repo(rust-block-comment)",
      },
    ],
  });
});

it("adds clippy's hits in the listed files, merged by place, and drops those in other files", () => {
  const root = plant({ "Cargo.lock": cargoLock("app"), "Cargo.toml": "", "src/lib.rs": USAGE });
  const result = rustHitsAt(root, ["src/lib.rs", "src/deleted.rs"], { clippy: true, run: lints });
  expect(result.ok && result.value.map((d) => d.line.split(": error ")[0])).toStrictEqual([
    "src/lib.rs:1:1",
    "src/lib.rs:2:1",
    "src/lib.rs:3:27",
  ]);
  expect(result.ok && result.value[2]).toStrictEqual({
    file: "src/lib.rs",
    line: "src/lib.rs:3:27: error clippy(unwrap_used): used `unwrap()` on a `Result` value",
    rule: "clippy(unwrap_used)",
  });
});

it("orders hits across files by path then place", () => {
  const root = plant({
    "Cargo.lock": cargoLock("app"),
    "Cargo.toml": "",
    "a.rs": "\n/* c */\n",
    "b.rs": "/* a */ /* b */\n",
  });

  const result = rustHitsAt(root, ["b.rs", "a.rs"], { clippy: false });
  expect(result.ok && result.value.map((d) => d.line.split(": error ")[0])).toStrictEqual([
    "a.rs:2:1",
    "b.rs:1:1",
    "b.rs:1:9",
  ]);
});

it("returns the clippy problems alone when the run failed", () => {
  const root = plant({ "Cargo.lock": cargoLock("app"), "Cargo.toml": "", "src/lib.rs": USAGE });
  expect(rustHitsAt(root, ["src/lib.rs"], { clippy: true, run: missing })).toStrictEqual({
    error: ["Cargo.toml is here but cargo is not on PATH; install rustup from https://rustup.rs"],
    ok: false,
  });
});
