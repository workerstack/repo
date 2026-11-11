import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, expect, it } from "vitest";

import { OK, PASSED, plant } from "../scripts/__fixtures__/ci-run.ts";
import { cleanTemps } from "../scripts/__fixtures__/turn-repo.ts";
import { main } from "../scripts/ci.ts";
import type { CargoResult, CargoRun } from "./clippy.ts";
import { rustTests } from "./rust-tests.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { force: true, recursive: true });
  cleanTemps();
});

function ok(stdout = "", stderr = ""): CargoResult {
  return { missing: false, status: 0, stderr, stdout };
}
function bad(status: number, stderr: string): CargoResult {
  return { missing: false, status, stderr, stdout: "" };
}
const GONE: CargoResult = { missing: true, status: 1, stderr: "", stdout: "" };
const SUMMARY = "     Summary [   0.002s] 1 test run: 1 passed, 0 skipped\n";
const DOCTEST_SUMMARY = "test result: ok. 1 passed; 0 failed; 0 ignored\n";
function metadata(...doctests: boolean[]) {
  const targets = doctests.map((doctest) => ({ doctest, kind: ["lib"] }));
  const packages = [
    { id: "a 0.1.0", targets },
    { id: "dep 1.0.0", targets: [{ doctest: true, kind: ["lib"] }] },
  ];
  return JSON.stringify({ packages, workspace_members: ["a 0.1.0"] });
}
const row = { functions: { percent: 66.7 }, lines: { percent: 66.7 }, regions: { percent: 58.3 } };
function reportAt(root: string) {
  return { data: [{ files: [{ filename: `${root}/a/src/lib.rs`, summary: row }] }] };
}

/** The answer key of a cargo call: its version probe by tool, else the subcommand. */
function keyOf(args: readonly string[]): string {
  if (args[1] === "--version") return args.slice(0, 2).join(" ");
  return { "llvm-cov": "llvm-cov run", nextest: "nextest run" }[args[0] ?? ""] ?? args[0] ?? "";
}

const HEALTHY: Record<string, CargoResult> = {
  "llvm-cov --version": ok("cargo-llvm-cov 0.9.1\n"),
  "llvm-cov run": ok("", SUMMARY),
  metadata: ok(metadata(true)),
  "nextest --version": ok("cargo-nextest 0.9.151 (6b3f99457 2026-11-02)\n"),
  "nextest run": ok("", SUMMARY),
  test: ok(DOCTEST_SUMMARY),
};

/** A floors file in a temp dir holding `rows`, and the path it is at. */
function floorsFile(rows: unknown): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rust-tests-"));
  dirs.push(dir);
  const file = path.join(dir, "floors.json");
  fs.writeFileSync(file, JSON.stringify(rows));
  return file;
}

/** A fake cargo at `root` answering by subcommand with `HEALTHY` overridden by `answers`; `seen` records the calls. */
function fakeCargo(root: string, answers: Record<string, CargoResult>, seen: string[]): CargoRun {
  return (_dir, args) => {
    seen.push(args.join(" "));
    if (keyOf(args) === "llvm-cov run") fs.writeFileSync(args.at(-1) ?? "", JSON.stringify(reportAt(root)));
    return { ...HEALTHY, ...answers }[keyOf(args)] ?? ok();
  };
}

type GateOptions = { coverage: boolean; floors?: string };

/** The gate over a fake cargo; `seen` records the calls. */
function gate(answers: Record<string, CargoResult>, { coverage, floors = "/nowhere/floors.json" }: GateOptions) {
  const seen: string[] = [];
  const run = fakeCargo("/r", answers, seen);
  return { ...rustTests("/r", { coverage, floors, run }), seen };
}

it("under coverage runs llvm-cov nextest and the doctests, and counts both", () => {
  const run = gate({}, { coverage: true });
  expect(run).toMatchObject({ label: "rust tests ok (1 test, 1 doctest)", ok: true, output: [], ran: true });
  expect(run.seen.map((call) => call.split(" ").slice(0, 3).join(" "))).toStrictEqual([
    "nextest --version",
    "llvm-cov --version",
    "llvm-cov nextest --locked",
    "metadata --no-deps --format-version",
    "test --doc --locked",
  ]);
  expect(run.seen[3]).toBe("metadata --no-deps --format-version 1 --locked");
  expect(run.seen[4]).toBe("test --doc --locked --workspace");
});

it("without coverage runs plain nextest, never asks for llvm-cov and checks no floor", () => {
  const floors = floorsFile({ "a/src/lib.rs": { functions: 100, lines: 100, regions: 100 } });
  const run = gate({}, { coverage: false, floors });
  expect(run.label).toBe("rust tests ok (1 test, 1 doctest)");
  expect(run.seen[1]).toBe("nextest run --locked --workspace --no-tests=warn");
  expect(run.seen.some((call) => call.startsWith("llvm-cov"))).toBe(false);
});

it("skips the doctests when no workspace target has doctest true, however many tests ran", () => {
  const run = gate({ metadata: ok(metadata(false)) }, { coverage: false });
  expect(run.label).toBe("rust tests ok (1 test)");
  expect(run.seen.some((call) => call.startsWith("test --doc"))).toBe(false);
});

it("pluralizes both counts and sums the doctest results of every crate", () => {
  const answers = {
    "nextest run": ok("", "     Summary [   0.5s] 3 tests run: 3 passed, 0 skipped\n"),
    test: ok(`${DOCTEST_SUMMARY}test result: ok. 2 passed; 0 failed\n`),
  };
  expect(gate(answers, { coverage: false }).label).toBe("rust tests ok (3 tests, 3 doctests)");
});

it("counts no tests when nextest ran none", () => {
  const answers = { metadata: ok(metadata(false)), "nextest run": ok("", "warning: no tests to run\n") };
  expect(gate(answers, { coverage: false }).label).toBe("rust tests ok (0 tests)");
});

it("a failing test fails the gate with nextest's output and runs no doctest", () => {
  const run = gate({ "nextest run": bad(100, "FAIL [ 0.002s] a tests::adds\n") }, { coverage: false });
  expect(run).toMatchObject({ label: "rust tests failed", ok: false, output: ["FAIL [ 0.002s] a tests::adds"] });
  expect(run.seen.some((call) => call.startsWith("metadata"))).toBe(false);
});

it("a failing test under coverage carries llvm-cov's exit and output", () => {
  const run = gate({ "llvm-cov run": bad(100, "FAIL a tests::adds\n") }, { coverage: true });
  expect(run).toMatchObject({ label: "rust tests failed", ok: false });
  expect(run.output.join("")).toContain("cargo llvm-cov exited 100:\nFAIL a tests::adds");
});

it("a failing doctest fails the gate with cargo's output", () => {
  const run = gate({ test: bad(101, "test src/lib.rs - add (line 3) ... FAILED\n") }, { coverage: false });
  expect(run).toMatchObject({ label: "rust tests failed", ok: false });
  expect(run.output).toStrictEqual(["test src/lib.rs - add (line 3) ... FAILED"]);
});

it.each(["nextest run", "metadata", "test"])("a cargo that goes missing at %s fails the gate", (key) => {
  const run = gate({ [key]: GONE }, { coverage: false });
  expect(run).toMatchObject({ label: "rust tests failed", ok: false });
  expect(run.output[0]).toContain("cargo");
});

it("a metadata run that fails or prints what repo cannot read fails the gate", () => {
  const failed = gate({ metadata: bad(101, "error: failed to parse manifest\n") }, { coverage: false });
  expect(failed.output).toStrictEqual(["cargo metadata exited 101: error: failed to parse manifest"]);
  const unreadable = "cargo metadata printed output repo cannot read:";
  expect(gate({ metadata: ok("not json") }, { coverage: false }).output).toStrictEqual([`${unreadable} not json`]);
  expect(gate({ metadata: ok('{"packages":1}') }, { coverage: false }).output).toStrictEqual([
    `${unreadable} {"packages":1}`,
  ]);
});

it("a missing nextest fails the gate with the install line and runs nothing else", () => {
  const run = gate({ "nextest --version": bad(101, "error: no such command: `nextest`\n") }, { coverage: true });
  expect(run.output).toStrictEqual([
    "cargo-nextest is not installed; run `cargo install --locked cargo-nextest@0.9.151`",
  ]);
  expect(run.seen).toStrictEqual(["nextest --version"]);
});

it("a wrong-version llvm-cov fails the gate under coverage but is not asked without it", () => {
  const answers = { "llvm-cov --version": ok("cargo-llvm-cov 0.8.0\n") };
  expect(gate(answers, { coverage: true }).output).toStrictEqual([
    "cargo-llvm-cov 0.8.0 is installed but repo pins 0.9.1; run `cargo install --locked cargo-llvm-cov@0.9.1`",
  ]);
  expect(gate(answers, { coverage: false }).ok).toBe(true);
});

it("a row below its floor fails the gate with the floor line, after the run passed", () => {
  const floors = floorsFile({ "a/src/lib.rs": { functions: 66, lines: 80, regions: 58 } });
  const run = gate({}, { coverage: true, floors });
  expect(run).toMatchObject({ label: "rust tests failed", ok: false });
  expect(run.output).toStrictEqual([
    "rust coverage: a/src/lib.rs lines 66 is below its floor 80; add tests or restore the code",
  ]);
});

it("rows at or above their floors pass, and a floors file that cannot be read fails with its reason", () => {
  const floors = floorsFile({ "a/src/lib.rs": { functions: 66, lines: 66, regions: 58 } });
  expect(gate({}, { coverage: true, floors }).ok).toBe(true);
  const unreadable = gate({}, { coverage: true, floors: floorsFile("nope") });
  expect(unreadable.ok).toBe(false);
  expect(unreadable.output[0]).toContain("is not an object of floors");
});

/** `repo ci` over a planted repo with `files`, the other gates faked and cargo fake. */
async function ciWith(files: Record<string, string>) {
  const root = plant(files);
  const [out, seen]: [string[], string[]] = [[], []];
  const code = await main([], {
    bins: { tsc: () => OK, vitest: () => PASSED },
    cargo: fakeCargo(root, {}, seen),
    cwd: root,
    now: () => 0,
    repo: () => OK,
    stdout: (text) => out.push(text),
  });
  return { code, out: out.join(""), seen };
}

it("repo ci runs the rust tests gate after the tests only in a repo with a root Cargo.toml", async () => {
  const rust = await ciWith({ "Cargo.toml": "[workspace]\n" });
  expect(rust.out).toContain("ci: 4 tests passed (0.0s)\nci: rust tests ok (1 test, 1 doctest) (0.0s)\n");
  const plain = await ciWith({});
  expect(plain.out).not.toContain("rust tests");
  expect(plain.seen).toStrictEqual([]);
});

it("repo ci holds the rust floors of the file the config names", async () => {
  const rows = { "a/src/lib.rs": { functions: 66, lines: 80, regions: 58 } };
  const run = await ciWith({
    "Cargo.toml": "[workspace]\n",
    "ratchets/floors.json": JSON.stringify(rows),
    "workerstack.config.ts": 'export default { coverage: { floors: "ratchets/floors.json" } };\n',
  });
  expect(run.code).toBe(1);
  expect(run.out).toContain(
    "ci: rust tests failed (0.0s)\nrust coverage: a/src/lib.rs lines 66 is below its floor 80;",
  );
});
