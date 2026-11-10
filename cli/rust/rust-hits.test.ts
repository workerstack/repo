import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { cargoLock } from "./fixtures/cargo-lock.ts";
import type { CargoRun } from "./clippy.ts";
import { rustFiles, rustHitsAt } from "./rust-hits.ts";

const temps: string[] = [];
afterEach(() => {
  for (const dir of temps.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

/** A temp dir holding `files`. */
function plant(files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "workerstack-rust-hits-"));
  temps.push(root);
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), text);
  }
  return root;
}

const git = (root: string, ...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8" });

/** A runner whose clippy output is one lint at `src/lib.rs:3:27` and one in a file the caller did not list. */
const lints: CargoRun = () => {
  const line = (file: string, text: string, rule: string) =>
    JSON.stringify({
      reason: "compiler-message",
      message: {
        level: "warning",
        message: text,
        code: { code: rule },
        spans: [{ file_name: file, is_primary: true, line_start: 3, column_start: 27 }],
      },
    });
  const stdout = [
    line("src/lib.rs", "used `unwrap()` on a `Result` value", "clippy::unwrap_used"),
    line("src/gone.rs", "elsewhere", "dead_code"),
  ].join("\n");
  return { status: 0, stdout, stderr: "", missing: false };
};

const USAGE = "#[allow(dead_code)]\n/* old */\npub fn f(s: &str) -> u8 { s.parse().unwrap() }\n";

it("lists the rust files git knows, tracked or not, outside fixtures and target dirs, sorted", () => {
  const root = plant({
    "src/lib.rs": "",
    "src/a.rs": "",
    "src/ignored.rs": "",
    ".gitignore": "ignored.rs\n",
    "tests/fixtures/x.rs": "",
    "target/debug/build.rs": "",
    "crates/foo/target/gen.rs": "",
    "src/readme.md": "",
    "src/target.rs": "",
  });
  git(root, "init", "-q");
  git(root, "add", "src/lib.rs");
  expect(rustFiles(root)).toEqual({ ok: true, files: ["src/a.rs", "src/lib.rs", "src/target.rs"] });
});

it("says git failed when the root is not a checkout", () => {
  const listed = rustFiles(path.join(plant({ "a.rs": "" }), "missing"));
  expect(listed.ok).toBe(false);
  expect(!listed.ok && listed.errors[0]).toMatch(/^git ls-files failed: /);
});

it("has no diagnostic without a root Cargo.toml", () => {
  const root = plant({ "src/lib.rs": USAGE });
  expect(rustHitsAt(root, ["src/lib.rs"], { clippy: true, run: lints })).toEqual({ ok: true, value: [] });
});

it("prints the source rules in Usage's form, in file order, without compiling when clippy is off", () => {
  const root = plant({ "Cargo.toml": "", "Cargo.lock": cargoLock("app"), "src/lib.rs": USAGE });
  const never: CargoRun = () => {
    throw new Error("cargo ran");
  };
  const text = "#[allow] sets a lint level in code; lint levels live on the command line, so fix the code";
  expect(rustHitsAt(root, ["src/lib.rs"], { clippy: false, run: never })).toEqual({
    ok: true,
    value: [
      {
        file: "src/lib.rs",
        rule: "repo(rust-lint-attribute)",
        line: `src/lib.rs:1:1: error repo(rust-lint-attribute): ${text} or add a lint.skip entry with a reason`,
      },
      {
        file: "src/lib.rs",
        rule: "repo(rust-block-comment)",
        line: "src/lib.rs:2:1: error repo(rust-block-comment): Rust comments use the line form (//, ///, //!); rewrite this /* */ as // lines",
      },
    ],
  });
});

it("adds clippy's hits in the listed files, merged by place, and drops those in other files", () => {
  const root = plant({ "Cargo.toml": "", "Cargo.lock": cargoLock("app"), "src/lib.rs": USAGE });
  const result = rustHitsAt(root, ["src/lib.rs", "src/deleted.rs"], { clippy: true, run: lints });
  expect(result.ok && result.value.map((d) => d.line.split(": error ")[0])).toEqual([
    "src/lib.rs:1:1",
    "src/lib.rs:2:1",
    "src/lib.rs:3:27",
  ]);
  expect(result.ok && result.value[2]).toEqual({
    file: "src/lib.rs",
    rule: "clippy(unwrap_used)",
    line: "src/lib.rs:3:27: error clippy(unwrap_used): used `unwrap()` on a `Result` value",
  });
});

it("orders hits across files by path then place", () => {
  const root = plant({
    "Cargo.toml": "",
    "Cargo.lock": cargoLock("app"),
    "b.rs": "/* a */ /* b */\n",
    "a.rs": "\n/* c */\n",
  });
  const result = rustHitsAt(root, ["b.rs", "a.rs"], { clippy: false });
  expect(result.ok && result.value.map((d) => d.line.split(": error ")[0])).toEqual([
    "a.rs:2:1",
    "b.rs:1:1",
    "b.rs:1:9",
  ]);
});

it("returns the clippy problems alone when the run failed", () => {
  const root = plant({ "Cargo.toml": "", "Cargo.lock": cargoLock("app"), "src/lib.rs": USAGE });
  const missing: CargoRun = () => ({ status: 1, stdout: "", stderr: "", missing: true });
  expect(rustHitsAt(root, ["src/lib.rs"], { clippy: true, run: missing })).toEqual({
    ok: false,
    errors: ["Cargo.toml is here but cargo is not on PATH; install rustup from https://rustup.rs"],
  });
});
