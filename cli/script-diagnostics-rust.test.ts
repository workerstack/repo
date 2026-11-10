import { execFileSync } from "node:child_process";
import { afterEach, expect, it, vi } from "vitest";
import { cleanTemps, plant } from "./magic/fixtures/magic-repo.ts";
import { cargoLock } from "./rust/fixtures/cargo-lock.ts";
import { MISSING_CARGO } from "./rust/clippy.constants.ts";
import type { CargoRun } from "./rust/clippy.ts";
import { checkScriptsAt, rustLintAt, scriptDiagnostics } from "./script-diagnostics.ts";

afterEach(cleanTemps);

const UNWRAP_LINE = "src/lib.rs:3:27: error clippy(unwrap_used): used `unwrap()` on a `Result` value";
const BLOCK_LINE =
  "src/lib.rs:2:1: error repo(rust-block-comment): Rust comments use the line form (//, ///, //!); rewrite this /* */ as // lines";
const LIB = "pub fn f() {}\n/* old */\npub fn g(s: &str) -> u8 { s.parse().unwrap() }\n";
const CARGO_TOML = '[package]\nname = "app"\nversion = "0.1.0"\nedition = "2021"\n';
const SKIP = { files: ["**/*.rs"], rules: ["clippy/unwrap_used"], reason: "the input is checked" };

/** A cargo run whose clippy prints the unwrap lint at `src/lib.rs:3:27`. */
const unwrap: CargoRun = () => ({
  status: 0,
  stdout: `${JSON.stringify({
    reason: "compiler-message",
    message: {
      level: "warning",
      message: "used `unwrap()` on a `Result` value",
      code: { code: "clippy::unwrap_used" },
      spans: [{ file_name: "src/lib.rs", is_primary: true, line_start: 3, column_start: 27 }],
    },
  })}\n`,
  stderr: "",
  missing: false,
});
const noCargo: CargoRun = () => ({ status: 1, stdout: "", stderr: "", missing: true });

/** A git checkout with the standards pack, `skip`, and `files`. */
function checkout(files: Record<string, string>, skip: object[] = []): string {
  const config = { packs: ["standards"], lint: { skip } };
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
    const files = { "Cargo.toml": CARGO_TOML, "Cargo.lock": cargoLock("app"), "src/lib.rs": LIB };
    const lines = (found: { all: { line: string }[] }) => found.all.map((d) => d.line);
    const open = await checkScriptsAt(checkout(files), unwrap);
    expect(lines(open)).toEqual([BLOCK_LINE, UNWRAP_LINE]);
    expect(open.kept).toEqual(open.all);
    const skipped = await checkScriptsAt(checkout(files, [SKIP]), unwrap);
    expect(lines(skipped)).toEqual([BLOCK_LINE, UNWRAP_LINE]);
    expect(skipped.kept.map((d) => d.line)).toEqual([BLOCK_LINE]);
  },
);

it("checkScriptsAt makes a missing cargo a problem, not a hit", async () => {
  const root = checkout({ "Cargo.toml": CARGO_TOML, "Cargo.lock": cargoLock("app"), "src/lib.rs": LIB });
  expect(await checkScriptsAt(root, noCargo)).toEqual({ all: [], kept: [], problems: [MISSING_CARGO] });
});

it("checkScriptsAt reports why the Rust files could not be listed", async () => {
  const root = plant({
    "Cargo.toml": CARGO_TOML,
    "Cargo.lock": cargoLock("app"),
    "workerstack.config.ts": 'export default { packs: ["standards"] };\n',
  });
  expect((await checkScriptsAt(root, noCargo)).problems).toEqual([expect.stringMatching(/^git ls-files failed: /)]);
});

it("a repo with no Cargo.toml gets the same result with Rust files in it, and no cargo runs", async () => {
  const run = vi.fn(unwrap);
  const files = { "src/a.ts": "export const f = () => 5000;\n" };
  const without = await checkScriptsAt(checkout(files), run);
  const withRust = await checkScriptsAt(checkout({ ...files, "src/lib.rs": LIB }), run);
  expect(withRust).toEqual(without);
  expect(without.all).toHaveLength(1);
  expect(run).not.toHaveBeenCalled();
});

it("scriptDiagnostics runs only the Rust source rules on the .rs files it is given, never cargo", () => {
  const root = plant({ "Cargo.toml": CARGO_TOML, "Cargo.lock": cargoLock("app"), "src/lib.rs": LIB });
  const found = scriptDiagnostics(root, ["src/lib.rs", "src/gone.rs"]);
  expect(found.ok ? found.value.map((d) => d.line) : found).toEqual([BLOCK_LINE]);
  const none = plant({ "src/lib.rs": LIB });
  expect(scriptDiagnostics(none, ["src/lib.rs"])).toEqual({ ok: true, value: [] });
});

it("rustLintAt lints the whole repo with clippy, or only the .rs paths given with the source rules", async () => {
  const files = {
    "Cargo.toml": CARGO_TOML,
    "Cargo.lock": cargoLock("app"),
    "src/lib.rs": LIB,
    "src/a.ts": "export const a = 1;\n",
  };
  const root = checkout(files, [SKIP]);
  expect(await rustLintAt(root, null, unwrap)).toEqual({ lines: [BLOCK_LINE], problems: [] });
  const open = checkout(files);
  expect(await rustLintAt(open, null, unwrap)).toEqual({ lines: [BLOCK_LINE, UNWRAP_LINE], problems: [] });
  expect(await rustLintAt(open, ["src/lib.rs", "src/a.ts"], noCargo)).toEqual({ lines: [BLOCK_LINE], problems: [] });
  expect(await rustLintAt(open, ["src/a.ts"], noCargo)).toEqual({ lines: [], problems: [] });
  expect(await rustLintAt(open, null, noCargo)).toEqual({ lines: [], problems: [MISSING_CARGO] });
});

it("rustLintAt lints nothing without a config or the standards pack", async () => {
  const none = { lines: [], problems: [] };
  expect(
    await rustLintAt(
      plant({ "Cargo.toml": CARGO_TOML, "Cargo.lock": cargoLock("app"), "src/lib.rs": LIB }),
      null,
      unwrap,
    ),
  ).toEqual(none);
});
