import { execFileSync } from "node:child_process";

import { afterEach, expect, it, vi } from "vitest";

import { cleanTemps, plant } from "./magic/fixtures/magic-repo.ts";
import { MISSING_CARGO } from "./rust/clippy.constants.ts";
import type { CargoRun } from "./rust/clippy.ts";
import { cargoLock } from "./rust/fixtures/cargo-lock.ts";
import { checkScriptsAt, scriptLintAt, scriptDiagnostics } from "./script-diagnostics.ts";
import { SLOW } from "./scripts/fixtures/baseline-repo.ts";

afterEach(cleanTemps);

const UNWRAP_LINE = "src/lib.rs:3:27: error clippy(unwrap_used): used `unwrap()` on a `Result` value";
const BLOCK_LINE =
  "src/lib.rs:2:1: error repo(rust-block-comment): Rust comments use the line form (//, ///, //!); rewrite this /* */ as // lines";
const LIB = "pub fn f() {}\n/* old */\npub fn g(s: &str) -> u8 { s.parse().unwrap() }\n";
const CARGO_TOML = '[package]\nname = "app"\nversion = "0.1.0"\nedition = "2021"\n';
const SKIP = { files: ["**/*.rs"], reason: "the input is checked", rules: ["clippy/unwrap_used"] };

/** A cargo run whose clippy prints the unwrap lint at `src/lib.rs:3:27`. */
const unwrap: CargoRun = () => ({
  missing: false,
  status: 0,
  stderr: "",
  stdout: `${JSON.stringify({
    message: {
      code: { code: "clippy::unwrap_used" },
      level: "warning",
      message: "used `unwrap()` on a `Result` value",
      spans: [{ column_start: 27, file_name: "src/lib.rs", is_primary: true, line_start: 3 }],
    },
    reason: "compiler-message",
  })}\n`,
});
const noCargo: CargoRun = () => ({ missing: true, status: 1, stderr: "", stdout: "" });

/** A git checkout with the standards pack, `skip`, and `files`. */
function checkout(files: Record<string, string>, skip: object[] = []): string {
  const config = { lint: { skip }, packs: ["standards"] };
  const root = plant({ ...files, "workerstack.config.ts": `export default ${JSON.stringify(config)};\n` });
  execFileSync("git", ["init", "-q"], { cwd: root });
  return root;
}

/** A real clippy build: its first compile on a CI runner takes far over the 5 s default. */
const CARGO_MS = 300_000;

it(
  "checkScriptsAt adds the Rust source and clippy hits, and a .rs skip glob turns a clippy hit off",
  { timeout: CARGO_MS },
  async () => {
    const files = { "Cargo.lock": cargoLock("app"), "Cargo.toml": CARGO_TOML, "src/lib.rs": LIB };
    const lines = (found: { all: { line: string }[] }) => found.all.map((d) => d.line);
    const open = await checkScriptsAt(checkout(files), unwrap);
    expect(lines(open)).toStrictEqual([BLOCK_LINE, UNWRAP_LINE]);
    expect(open.kept).toStrictEqual(open.all);
    const skipped = await checkScriptsAt(checkout(files, [SKIP]), unwrap);
    expect(lines(skipped)).toStrictEqual([BLOCK_LINE, UNWRAP_LINE]);
    expect(skipped.kept.map((d) => d.line)).toStrictEqual([BLOCK_LINE]);
  },
);

it("checkScriptsAt makes a missing cargo a problem, not a hit", async () => {
  const root = checkout({ "Cargo.lock": cargoLock("app"), "Cargo.toml": CARGO_TOML, "src/lib.rs": LIB });
  expect(await checkScriptsAt(root, noCargo)).toStrictEqual({ all: [], kept: [], problems: [MISSING_CARGO] });
});

it("checkScriptsAt reports why the Rust files could not be listed", async () => {
  const root = plant({
    "Cargo.lock": cargoLock("app"),
    "Cargo.toml": CARGO_TOML,
    "workerstack.config.ts": 'export default { packs: ["standards"] };\n',
  });
  expect((await checkScriptsAt(root, noCargo)).problems).toStrictEqual([
    expect.stringMatching(/^git ls-files failed: /),
  ]);
});

it("a repo with no Cargo.toml gets the same result with Rust files in it, and no cargo runs", async () => {
  const run = vi.fn(unwrap);
  const files = { "src/a.ts": "export const f = () => 5000;\n" };
  const without = await checkScriptsAt(checkout(files), run);
  const withRust = await checkScriptsAt(checkout({ ...files, "src/lib.rs": LIB }), run);
  expect(withRust).toStrictEqual(without);
  expect(without.all).toHaveLength(1);
  expect(run).not.toHaveBeenCalled();
});

it("scriptDiagnostics runs only the Rust source rules on the .rs files it is given, never cargo", () => {
  const root = plant({ "Cargo.lock": cargoLock("app"), "Cargo.toml": CARGO_TOML, "src/lib.rs": LIB });
  const found = scriptDiagnostics(root, ["src/lib.rs", "src/gone.rs"]);
  expect(found.ok ? found.value.map((d) => d.line) : found).toStrictEqual([BLOCK_LINE]);
  const none = plant({ "src/lib.rs": LIB });
  expect(scriptDiagnostics(none, ["src/lib.rs"])).toStrictEqual({ ok: true, value: [] });
});

const WHOLE = { clippy: true, paths: null };

it("scriptLintAt reports why the files could not be listed", { timeout: SLOW }, async () => {
  const root = plant({
    "Cargo.lock": cargoLock("app"),
    "Cargo.toml": CARGO_TOML,
    "workerstack.config.ts": 'export default { packs: ["standards"] };\n',
  });
  expect((await scriptLintAt(root, WHOLE, noCargo)).problems).toStrictEqual([
    expect.stringMatching(/^git ls-files failed: /),
  ]);
});

it(
  "scriptLintAt lints the whole repo with clippy, or only the .rs paths given with the source rules",
  { timeout: SLOW },
  async () => {
    const files = {
      "Cargo.lock": cargoLock("app"),
      "Cargo.toml": CARGO_TOML,
      "src/a.ts": "export const a = 1;\n",
      "src/lib.rs": LIB,
    };
    const root = checkout(files, [SKIP]);
    expect(await scriptLintAt(root, WHOLE, unwrap)).toStrictEqual({ lines: [BLOCK_LINE], problems: [] });
    const open = checkout(files);
    expect(await scriptLintAt(open, WHOLE, unwrap)).toStrictEqual({ lines: [BLOCK_LINE, UNWRAP_LINE], problems: [] });
    expect(await scriptLintAt(open, { clippy: false, paths: ["src/lib.rs", "src/a.ts"] }, noCargo)).toStrictEqual({
      lines: [BLOCK_LINE],
      problems: [],
    });
    expect(await scriptLintAt(open, { clippy: false, paths: ["src/a.ts"] }, noCargo)).toStrictEqual({
      lines: [],
      problems: [],
    });
    expect(await scriptLintAt(open, WHOLE, noCargo)).toStrictEqual({ lines: [], problems: [MISSING_CARGO] });
  },
);

it("scriptLintAt lints nothing without a config or the standards pack", { timeout: SLOW }, async () => {
  const none = { lines: [], problems: [] };
  expect(
    await scriptLintAt(
      plant({ "Cargo.lock": cargoLock("app"), "Cargo.toml": CARGO_TOML, "src/lib.rs": LIB }),
      WHOLE,
      unwrap,
    ),
  ).toStrictEqual(none);
});
