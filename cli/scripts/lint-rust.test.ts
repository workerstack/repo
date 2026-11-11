import fs from "node:fs";
import path from "node:path";

import { afterEach, expect, it, vi } from "vitest";

import { cargoLock } from "../rust/__fixtures__/cargo-lock.ts";
import { MISSING_CARGO } from "../rust/clippy.constants.ts";
import type { CargoRun } from "../rust/clippy.ts";
import { cleanTemps, consumer, SLOW } from "./__fixtures__/baseline-repo.ts";
import { pathSans } from "./__fixtures__/job-kit.ts";
import { lintMain } from "./lint-main.ts";
import { fmt } from "./lint.ts";

/** A cold cargo build of a tiny crate, with room for a busy CI runner. */
const CARGO_MS = 300_000;
const CARGO_TOML = '[package]\nname = "app"\nversion = "0.1.0"\nedition = "2021"\n';
const USAGE = "#[allow(dead_code)]\n/* old */\npub fn f(s: &str) -> u8 { s.parse().unwrap() }\n";
const ATTRIBUTE_LINE =
  "src/lib.rs:1:1: error repo(rust-lint-attribute): #[allow] sets a lint level in code; lint levels live on the " +
  "command line, so fix the code or add a lint.skip entry with a reason";
const BLOCK_LINE =
  "src/lib.rs:2:1: error repo(rust-block-comment): Rust comments use the line form (//, ///, //!); " +
  "rewrite this /* */ as // lines";
const UNWRAP_LINE = "src/lib.rs:3:27: error clippy(unwrap_used): used `unwrap()` on a `Result` value";

const saved = process.cwd();
afterEach(() => {
  process.chdir(saved);
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  cleanTemps();
});

/** What a spied stream was asked to print, one string per write. */
function printed(out: { mock: { calls: unknown[][] } }) {
  return out.mock.calls.map(([text]) => String(text));
}

it(
  "repo lint prints each Rust hit with its message and exits 1; the source rules alone for paths",
  { timeout: CARGO_MS },
  async () => {
    const root = consumer({ "Cargo.lock": cargoLock("app"), "Cargo.toml": CARGO_TOML, "src/lib.rs": USAGE });
    const out = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    process.chdir(root);
    expect(await lintMain(["src/lib.rs"])).toBe(1);
    expect(printed(out)).toStrictEqual([`${ATTRIBUTE_LINE}\n`, `${BLOCK_LINE}\n`]);
    out.mockClear();
    expect(await lintMain([])).toBe(1);
    // Pedantic adds its own hits to the three of the Usage.
    expect(printed(out)).toStrictEqual(
      expect.arrayContaining([`${ATTRIBUTE_LINE}\n`, `${BLOCK_LINE}\n`, `${UNWRAP_LINE}\n`]),
    );
  },
);

it("repo lint passes a clean crate, and leaves a skipped hit out", { timeout: CARGO_MS }, async () => {
  const clean = "/// Parses `s`.\n#[must_use]\npub fn f(s: &str) -> Option<u8> {\n    s.parse().ok()\n}\n";
  const root = consumer({ "Cargo.lock": cargoLock("app"), "Cargo.toml": CARGO_TOML, "src/lib.rs": clean });
  const out = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  process.chdir(root);
  expect(await lintMain([])).toBe(0);
  expect(printed(out)).toStrictEqual([]);
  const skip = { files: ["src/lib.rs"], reason: "the input is checked", rules: ["clippy/unwrap_used"] };
  const config = { lint: { skip: [skip] }, packs: ["standards"] };
  fs.writeFileSync(path.join(root, "workerstack.config.ts"), `export default ${JSON.stringify(config, null, 2)};\n`);
  fs.writeFileSync(
    path.join(root, "src/lib.rs"),
    `${clean}\n/// Parses the text.\n///\n/// # Panics\n///\n/// When it is not a number.\n` +
      "#[must_use]\npub fn g(s: &str) -> u8 {\n    s.parse().unwrap()\n}\n",
  );
  expect(await lintMain([])).toBe(0);
  expect(printed(out)).toStrictEqual([]);
});

it("repo lint without a Cargo.toml runs no Rust rules", { timeout: SLOW }, async () => {
  const out = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  process.chdir(consumer({ "src/lib.rs": USAGE }));
  expect(await lintMain([])).toBe(0);
  expect(printed(out)).toStrictEqual([]);
});

it("repo lint reaches the .rs sources under a directory argument", { timeout: SLOW }, async () => {
  const out = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  process.chdir(consumer({ "Cargo.lock": cargoLock("app"), "Cargo.toml": CARGO_TOML, "src/lib.rs": USAGE }));
  expect(await lintMain(["src"])).toBe(1);
  expect(printed(out)).toStrictEqual([`${ATTRIBUTE_LINE}\n`, `${BLOCK_LINE}\n`]);
});

it("repo lint --quiet runs the Rust source rules on the repo, and no clippy", { timeout: SLOW }, async () => {
  const out = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  process.chdir(consumer({ "Cargo.lock": cargoLock("app"), "Cargo.toml": CARGO_TOML, "src/lib.rs": USAGE }));
  expect(await lintMain(["--quiet"])).toBe(1);
  expect(printed(out)).toStrictEqual([`${ATTRIBUTE_LINE}\n`, `${BLOCK_LINE}\n`]);
});

it("repo lint of no arguments prints each source hit once beside clippy's", { timeout: CARGO_MS }, async () => {
  const out = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  process.chdir(consumer({ "Cargo.lock": cargoLock("app"), "Cargo.toml": CARGO_TOML, "src/lib.rs": USAGE }));
  expect(await lintMain([])).toBe(1);
  const sources = printed(out).filter((line) => line.includes(" error repo(rust-"));
  expect(sources).toStrictEqual([`${ATTRIBUTE_LINE}\n`, `${BLOCK_LINE}\n`]);
  expect(printed(out)).toContain(`${UNWRAP_LINE}\n`);
});

it("repo lint reports a missing cargo as a problem and fails", { timeout: SLOW }, async () => {
  const err = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  process.chdir(consumer({ "Cargo.lock": cargoLock("app"), "Cargo.toml": CARGO_TOML, "src/lib.rs": USAGE }));
  vi.stubEnv("PATH", pathSans("cargo"));
  expect(await lintMain([])).toBe(1);
  expect(err).toHaveBeenCalledWith(`repo lint: ${MISSING_CARGO}\n`);
});

it(
  "repo fmt --check fails on an unformatted .rs with its diff, and passes after repo fmt",
  { timeout: CARGO_MS },
  async () => {
    const root = consumer({
      "Cargo.lock": cargoLock("app"),
      "Cargo.toml": CARGO_TOML,
      "src/lib.rs": "pub fn f()   {  }\n",
    });
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

/** A cargo that is not installed. */
function missingCargo(): ReturnType<CargoRun> {
  return { missing: true, status: 1, stderr: "", stdout: "" };
}

/** A cargo killed by a signal. */
function signalledCargo(): ReturnType<CargoRun> {
  return { missing: false, status: null, stderr: "boom\n", stdout: "" };
}

it("repo fmt names the missing cargo, keeps a failing oxfmt code, and skips cargo without a Cargo.toml", async () => {
  const err: string[] = [];
  function stderr(text: string) {
    return err.push(text);
  }
  const root = consumer({ "Cargo.toml": CARGO_TOML });
  expect(await fmt([], { cargo: missingCargo, cwd: root, stderr })).toBe(1);
  expect(err).toStrictEqual([`repo fmt: ${MISSING_CARGO}\n`]);
  expect(await fmt([], { cargo: signalledCargo, cwd: root, stderr, stdout: () => {} })).toBe(1);
  const calls = vi.fn<CargoRun>(missingCargo);
  const plain = consumer({ "src/a.ts": "export const a = 1;\n" });
  expect(await fmt([], { cargo: calls, cwd: plain, stderr })).toBe(0);
  expect(calls).not.toHaveBeenCalled();
  const failing = consumer({
    "Cargo.lock": cargoLock("app"),
    "Cargo.toml": CARGO_TOML,
    "src/a.ts": "export const a = {b:1}\n",
  });
  expect(await fmt(["--check"], { cargo: calls, cwd: failing, stderr })).toBe(1);
});
