import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterAll, expect, it, vi } from "vitest";

import { clippyHits, runCargo, type CargoResult, type CargoRun } from "./clippy.ts";
import { cargoLock } from "./fixtures/cargo-lock.ts";

const MISSING = "Cargo.toml is here but cargo is not on PATH; install rustup from https://rustup.rs";
const ARGS = [
  ..."clippy --all-targets --all-features --locked --message-format=json --".split(" "),
  ..."-W clippy::pedantic -W clippy::unwrap_used -W clippy::expect_used".split(" "),
  ..."-W clippy::undocumented_unsafe_blocks -W clippy::unnecessary_safety_comment -W unreachable_pub".split(" "),
];

/** A root with a Cargo.lock, and one without. */
const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "workerstack-clippy-"));
fs.writeFileSync(path.join(ROOT, "Cargo.lock"), cargoLock("app"));
afterAll(() => fs.rmSync(ROOT, { force: true, recursive: true }));

type Span = { file: string; line: number; column: number; primary: boolean };

/** A span as cargo 1.99.1 prints it. */
const spanJson = (span: Span) => ({
  byte_end: 20,
  byte_start: 19,
  column_end: span.column + 1,
  column_start: span.column,
  expansion: null,
  file_name: span.file,
  is_primary: span.primary,
  label: null,
  line_end: span.line,
  line_start: span.line,
  suggested_replacement: null,
  suggestion_applicability: null,
  text: [],
});

/** A builder of `compiler-message` lines at `level`, shaped as cargo 1.99.1 prints them. */
const diag =
  (level: string) =>
  (code: string | null, text: string, spans: Span[] = []): string =>
    JSON.stringify({
      manifest_path: "/crate/Cargo.toml",
      message: {
        $message_type: "diagnostic",
        children: [{ children: [], code: null, level: "note", message: "a note", rendered: null, spans: [] }],
        code: code === null ? null : { code, explanation: null },
        level,
        message: text,
        rendered: `${level}: ${text}\n`,
        spans: spans.map(spanJson),
      },
      package_id: "path+file:///crate#0.1.0",
      reason: "compiler-message",
      target: { crate_types: ["lib"], edition: "2021", kind: ["lib"], name: "c1", src_path: "/crate/src/lib.rs" },
    });
const warning = diag("warning");
const error = diag("error");
const note = diag("note");
const failureNote = diag("failure-note");
const FINISHED = (success: boolean) => JSON.stringify({ reason: "build-finished", success });
const ARTIFACT = JSON.stringify({ filenames: [], fresh: false, package_id: "p", reason: "compiler-artifact" });
/** A primary span, and one that is not. */
const at = (line: number, column: number, file = "src/lib.rs"): Span => ({ column, file, line, primary: true });
const aside = (line: number, column: number, file = "src/lib.rs"): Span => ({ column, file, line, primary: false });

/** A runner that records its call and returns `lines` as stdout with exit `status`. */
function cargo(lines: string[], status = 0, extra: Partial<CargoResult> = {}) {
  const calls: { root: string; args: readonly string[] }[] = [];
  const run: CargoRun = (root, args) => {
    calls.push({ args, root });
    return { missing: false, status, stderr: "", stdout: lines.join("\n"), ...extra };
  };
  return { calls, run };
}

it("runs cargo clippy with the repo's levels in the root", () => {
  const { run, calls } = cargo([FINISHED(true)]);
  expect(clippyHits(ROOT, run)).toEqual({ ok: true, value: [] });
  expect(calls).toEqual([{ args: ARGS, root: ROOT }]);
});

it("reports a clippy lint at its primary span as clippy/<name>", () => {
  const text = "used `unwrap()` on a `Result` value";
  const lines = [ARTIFACT, warning("clippy::unwrap_used", text, [at(3, 27)]), FINISHED(true)];
  expect(clippyHits(ROOT, cargo(lines).run)).toEqual({
    ok: true,
    value: [{ column: 27, file: "src/lib.rs", line: 3, message: text, rule: "clippy/unwrap_used" }],
  });
});

it("reports a rustc lint as rust/<name>", () => {
  const lines = [warning("unreachable_pub", "unreachable `pub` item", [at(1, 13)])];
  expect(clippyHits(ROOT, cargo(lines).run)).toEqual({
    ok: true,
    value: [
      { column: 13, file: "src/lib.rs", line: 1, message: "unreachable `pub` item", rule: "rust/unreachable_pub" },
    ],
  });
});

it("reports a deny-level lint as a hit, since the build still names it", () => {
  const lines = [error("clippy::absurd_extreme_comparisons", "absurd", [at(2, 5)])];
  const result = clippyHits(ROOT, cargo(lines, 101).run);
  expect(result).toMatchObject({ ok: true, value: [{ line: 2, rule: "clippy/absurd_extreme_comparisons" }] });
});

it("takes the primary span and ignores the others", () => {
  const spans = [aside(9, 9, "src/other.rs"), at(4, 8)];
  const result = clippyHits(ROOT, cargo([warning("clippy::needless_x", "m", spans)]).run);
  expect(result).toMatchObject({ ok: true, value: [{ column: 8, file: "src/lib.rs", line: 4 }] });
});

it("counts a lint once when the lib and its test target both print it", () => {
  const line = warning("dead_code", "function `g` is never used", [at(1, 20)]);
  const result = clippyHits(ROOT, cargo([line, line]).run);
  expect(result).toMatchObject({ ok: true, value: [{ rule: "rust/dead_code" }] });
  expect(result.ok && result.value).toHaveLength(1);
});

it("makes a backslash file_name a POSIX path", () => {
  const span = at(2, 3, "members\\foo\\src\\lib.rs");
  const result = clippyHits(ROOT, cargo([warning("clippy::too_many_arguments", "m", [span])]).run);
  expect(result).toMatchObject({ ok: true, value: [{ file: "members/foo/src/lib.rs" }] });
});

it("drops a leading ./ from the file_name", () => {
  const result = clippyHits(ROOT, cargo([warning("dead_code", "m", [at(1, 1, ".\\src\\lib.rs")])]).run);
  expect(result).toMatchObject({ ok: true, value: [{ file: "src/lib.rs" }] });
});

it("ignores a warning or note without a lint code", () => {
  const lines = [warning(null, "1 warning emitted"), failureNote(null, "explain")];
  expect(clippyHits(ROOT, cargo(lines).run)).toEqual({ ok: true, value: [] });
});

it("ignores a message that is neither a warning nor an error, and a warning with a compiler error code", () => {
  const lines = [note("dead_code", "n", [at(1, 1)]), warning("E0001", "w", [at(1, 1)])];
  expect(clippyHits(ROOT, cargo(lines).run)).toEqual({ ok: true, value: [] });
});

it("makes an E0308 error a problem with its place, never a hit", () => {
  const lines = [error("E0308", "mismatched types", [at(1, 21), aside(1, 5)])];
  expect(clippyHits(ROOT, cargo([...lines, FINISHED(false)], 101).run)).toEqual({
    errors: ["cargo clippy: error[E0308]: mismatched types (src/lib.rs:1)"],
    ok: false,
  });
});

it("makes an error without a code a problem", () => {
  const lines = [error(null, "this file contains an unclosed delimiter"), FINISHED(false)];
  expect(clippyHits(ROOT, cargo(lines, 101).run)).toEqual({
    errors: ["cargo clippy: error: this file contains an unclosed delimiter"],
    ok: false,
  });
});

it("lists a repeated problem once and no hit beside it", () => {
  const failure = error("E0308", "mismatched types", [at(1, 21)]);
  const hit = warning("dead_code", "m", [at(1, 1)]);
  expect(clippyHits(ROOT, cargo([hit, failure, failure], 101).run)).toEqual({
    errors: ["cargo clippy: error[E0308]: mismatched types (src/lib.rs:1)"],
    ok: false,
  });
});

it("makes a lint with no primary span a problem", () => {
  const lines = [warning("dead_code", "never used", [aside(1, 1)])];
  expect(clippyHits(ROOT, cargo(lines).run)).toEqual({
    errors: ["cargo clippy: never used has a lint code but no primary span"],
    ok: false,
  });
});

it("makes a non-zero exit with no error message a problem, with stderr", () => {
  const run = cargo([FINISHED(false)], 101, { stderr: "error: could not find `Cargo.toml`\n" }).run;
  expect(clippyHits(ROOT, run)).toEqual({
    errors: ["cargo clippy exited 101 and printed no error: error: could not find `Cargo.toml`"],
    ok: false,
  });
});

it("names the exit alone when cargo printed nothing else", () => {
  expect(clippyHits(ROOT, cargo([], 2).run)).toEqual({
    errors: ["cargo clippy exited 2 and printed no error"],
    ok: false,
  });
});

it("makes a line it cannot read a problem", () => {
  const lines = ["not json", JSON.stringify({ message: { level: 1 }, reason: "compiler-message" }), '{"x":1}', ""];
  expect(clippyHits(ROOT, cargo(lines).run)).toEqual({
    errors: [
      "cargo clippy printed a line repo cannot read: not json",
      'cargo clippy printed a line repo cannot read: {"message":{"level":1},"reason":"compiler-message"}',
      'cargo clippy printed a line repo cannot read: {"x":1}',
    ],
    ok: false,
  });
});

it("cuts a long unreadable line", () => {
  expect(clippyHits(ROOT, cargo(["x".repeat(200)]).run)).toEqual({
    errors: [`cargo clippy printed a line repo cannot read: ${"x".repeat(80)}...`],
    ok: false,
  });
});

it("tells where to get cargo when it is not on PATH", () => {
  expect(clippyHits(ROOT, cargo([], 1, { missing: true }).run)).toEqual({ errors: [MISSING], ok: false });
});

it("the default runner reports a cargo missing from PATH", () => {
  vi.stubEnv("PATH", "");
  expect(runCargo(process.cwd(), ["--version"])).toMatchObject({ missing: true, status: 1, stdout: "" });
});
