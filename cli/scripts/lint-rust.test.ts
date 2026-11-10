import fs from "node:fs";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { MISSING_CARGO } from "../rust/clippy.constants.ts";
import type { CargoRun } from "../rust/clippy.ts";
import { cleanTemps, consumer, SLOW } from "./fixtures/baseline-repo.ts";
import { lintMain } from "./lint-main.ts";
import { fmt } from "./lint.ts";

/** A cold cargo build of a tiny crate, with room for a busy CI runner. */
const CARGO_MS = 300_000;
const CARGO_TOML = '[package]\nname = "app"\nversion = "0.1.0"\nedition = "2021"\n';
const USAGE = "#[allow(dead_code)]\n/* old */\npub fn f(s: &str) -> u8 { s.parse().unwrap() }\n";
const ATTRIBUTE_LINE =
  "src/lib.rs:1:1: error repo(rust-lint-attribute): #[allow] sets a lint level in code; lint levels live on the command line, so fix the code or add a lint.skip entry with a reason";
const BLOCK_LINE =
  "src/lib.rs:2:1: error repo(rust-block-comment): Rust comments use the line form (//, ///, //!); rewrite this /* */ as // lines";
const UNWRAP_LINE = "src/lib.rs:3:27: error clippy(unwrap_used): used `unwrap()` on a `Result` value";

const saved = process.cwd();
afterEach(() => {
  process.chdir(saved);
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  cleanTemps();
});

/** What a spied stream was asked to print, one string per write. */
const printed = (out: { mock: { calls: unknown[][] } }) => out.mock.calls.map(([text]) => String(text));

it(
  "repo lint prints each Rust hit with its message and exits 1; the source rules alone for paths",
  { timeout: CARGO_MS },
  async () => {
    const root = consumer({ "Cargo.toml": CARGO_TOML, "src/lib.rs": USAGE });
    const out = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    process.chdir(root);
    expect(await lintMain(["src/lib.rs"])).toBe(1);
    expect(printed(out)).toEqual([`${ATTRIBUTE_LINE}\n`, `${BLOCK_LINE}\n`]);
    out.mockClear();
    expect(await lintMain([])).toBe(1);
    // Pedantic adds its own hits to the three of the Usage.
    expect(printed(out)).toEqual(
      expect.arrayContaining([`${ATTRIBUTE_LINE}\n`, `${BLOCK_LINE}\n`, `${UNWRAP_LINE}\n`]),
    );
  },
);

it("repo lint passes a clean crate, and leaves a skipped hit out", { timeout: CARGO_MS }, async () => {
  const clean = "/// Parses `s`.\n#[must_use]\npub fn f(s: &str) -> Option<u8> {\n    s.parse().ok()\n}\n";
  const root = consumer({ "Cargo.toml": CARGO_TOML, "src/lib.rs": clean });
  const out = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  process.chdir(root);
  expect(await lintMain([])).toBe(0);
  expect(printed(out)).toEqual([]);
  const skip = { files: ["src/lib.rs"], rules: ["clippy/unwrap_used"], reason: "the input is checked" };
  const config = { packs: ["standards"], lint: { skip: [skip] } };
  fs.writeFileSync(path.join(root, "workerstack.config.ts"), `export default ${JSON.stringify(config)};\n`);
  fs.writeFileSync(
    path.join(root, "src/lib.rs"),
    `${clean}\n/// Parses the text.\n///\n/// # Panics\n///\n/// When it is not a number.\n#[must_use]\npub fn g(s: &str) -> u8 {\n    s.parse().unwrap()\n}\n`,
  );
  expect(await lintMain([])).toBe(0);
  expect(printed(out)).toEqual([]);
});

it("repo lint with only flags, or without a Cargo.toml, runs oxlint alone", { timeout: SLOW }, async () => {
  const out = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  process.chdir(consumer({ "Cargo.toml": CARGO_TOML, "src/lib.rs": USAGE }));
  expect(await lintMain(["--quiet"])).toBe(0);
  process.chdir(consumer({ "src/lib.rs": USAGE }));
  expect(await lintMain([])).toBe(0);
  expect(printed(out)).toEqual([]);
});

it("repo lint reports a missing cargo as a problem and fails", { timeout: SLOW }, async () => {
  const err = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  process.chdir(consumer({ "Cargo.toml": CARGO_TOML, "src/lib.rs": USAGE }));
  vi.stubEnv("PATH", "");
  expect(await lintMain([])).toBe(1);
  expect(err).toHaveBeenCalledWith(`repo lint: ${MISSING_CARGO}\n`);
});

it(
  "repo fmt --check fails on an unformatted .rs with its diff, and passes after repo fmt",
  { timeout: CARGO_MS },
  async () => {
    const root = consumer({ "Cargo.toml": CARGO_TOML, "src/lib.rs": "pub fn f()   {  }\n" });
    const out = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const here = { cwd: root };
    expect(await fmt(["--check"], here)).toBe(1);
    // cargo fmt prints the native path: `src\lib.rs` on Windows.
    expect(printed(out).join("")).toContain(path.join("src", "lib.rs"));
    expect(await fmt([], here)).toBe(0);
    expect(fs.readFileSync(path.join(root, "src/lib.rs"), "utf8")).toBe("pub fn f() {}\n");
    expect(await fmt(["--check"], here)).toBe(0);
  },
);

it("repo fmt names the missing cargo, keeps a failing oxfmt code, and skips cargo without a Cargo.toml", async () => {
  const err: string[] = [];
  const stderr = (text: string) => err.push(text);
  const missing: CargoRun = () => ({ status: 1, stdout: "", stderr: "", missing: true });
  const root = consumer({ "Cargo.toml": CARGO_TOML });
  expect(await fmt([], { cwd: root, stderr, cargo: missing })).toBe(1);
  expect(err).toEqual([`repo fmt: ${MISSING_CARGO}\n`]);
  const signalled: CargoRun = () => ({ status: null, stdout: "", stderr: "boom\n", missing: false });
  expect(await fmt([], { cwd: root, stderr, cargo: signalled, stdout: () => undefined })).toBe(1);
  const calls = vi.fn(missing);
  const plain = consumer({ "src/a.ts": "export const a = 1;\n" });
  expect(await fmt([], { cwd: plain, stderr, cargo: calls })).toBe(0);
  expect(calls).not.toHaveBeenCalled();
  const failing = consumer({ "Cargo.toml": CARGO_TOML, "src/a.ts": "export const a = {b:1}\n" });
  expect(await fmt(["--check"], { cwd: failing, stderr, cargo: calls })).toBe(1);
});
