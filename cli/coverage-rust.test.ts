import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { expect, it } from "vitest";
import { z } from "zod";

import { useCapturedRun } from "./__fixtures__/captured-run.ts";
import { main } from "./coverage.ts";
import { type Json, readJson } from "./json.ts";
import type { CargoRun } from "./rust/clippy.ts";

const FLOORS = "coverage-floors.json";
const LIB = "a/src/lib.rs";
const ROW = { functions: 66, lines: 66, regions: 58 };
const { err, out, temps } = useCapturedRun();

/** A cargo whose tests fail with one failing test name. */
function failsTest(): ReturnType<CargoRun> {
  return { missing: false, status: 100, stderr: "", stdout: "FAIL tests::adds" };
}

/** A cargo that must not be called. */
function neverRuns(): never {
  throw new Error("cargo must not run");
}

/** A temp repo with a root Cargo.toml and no vitest, so only Rust is measured. */
function rustRepo(): string {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "workerstack-coverage-rust-")));
  temps.push(root);
  fs.writeFileSync(path.join(root, "repo.config.ts"), "export default {};\n");
  fs.writeFileSync(path.join(root, "Cargo.toml"), "[workspace]\nmembers = []\n");

  return root;
}

/** A cargo that writes a llvm-cov report with `a/src/lib.rs` under `root` at `lines` percent. */
function cargoReporting(root: string, lines: number): CargoRun {
  const row = { summary: { functions: { percent: 66.7 }, lines: { percent: lines }, regions: { percent: 58.3 } } };
  const report = { data: [{ files: [{ filename: path.join(root, LIB), ...row }] }] };

  return (_cwd, args) => {
    fs.writeFileSync(String(args.at(-1)), JSON.stringify(report));

    return { missing: false, status: 0, stderr: "", stdout: "" };
  };
}

/** Runs `repo coverage` in `root` with `run` as cargo. */
function coverage(root: string, run: CargoRun): Promise<number> {
  process.chdir(root);

  return main([], run);
}

function floorsOf(root: string): Json {
  return readJson(z.json(), fs.readFileSync(path.join(root, FLOORS), "utf8"));
}

function plant(root: string, floors: Json): void {
  return fs.writeFileSync(path.join(root, FLOORS), JSON.stringify(floors));
}

it("repo coverage: writes Rust rows in a repo with no vitest, saying each is new", async () => {
  const root = rustRepo();
  expect(await coverage(root, cargoReporting(root, 66.7))).toBe(0);
  expect(floorsOf(root)).toStrictEqual({ [LIB]: ROW });
  const rows = ["lines new → 66", "functions new → 66", "regions new → 58"].map((line) => `${LIB} ${line}\n`);
  expect(out.join("")).toBe(`${rows.join("")}wrote ${FLOORS}\n`);
});

it("repo coverage: prints a raised Rust floor", async () => {
  const root = rustRepo();
  plant(root, { [LIB]: { ...ROW, lines: 50 } });
  expect(await coverage(root, cargoReporting(root, 66.7))).toBe(0);
  expect(out.join("")).toBe(`${LIB} lines 50 → 66\nwrote ${FLOORS}\n`);
});

it("repo coverage: fails a Rust drop with its line and keeps the old floors", async () => {
  const root = rustRepo();
  plant(root, { [LIB]: { ...ROW, lines: 80 } });
  expect(await coverage(root, cargoReporting(root, 66.7))).toBe(1);
  expect(err.join("")).toBe(`coverage: ${LIB} lines would drop 80 → 66; restore the tests or keep the floor\n`);
  expect(floorsOf(root)).toStrictEqual({ [LIB]: { ...ROW, lines: 80 } });
});

it("repo coverage: fails a failing Rust test with cargo's output and writes nothing", async () => {
  const root = rustRepo();
  expect(await coverage(root, failsTest)).toBe(1);
  expect(err.join("")).toContain("cargo llvm-cov exited 100:\nFAIL tests::adds");
  expect(err.join("")).toContain("coverage: the Rust tests failed; fix them before raising floors\n");
  expect(fs.existsSync(path.join(root, FLOORS))).toBe(false);
});

it("repo coverage: names a floors file with a bad row before running anything", async () => {
  const root = rustRepo();
  plant(root, { [LIB]: { lines: 1 } });
  expect(await coverage(root, neverRuns)).toBe(1);
  expect(err.join("")).toContain(`coverage: ${path.join(root, FLOORS)}: ${LIB} has a bad floor row`);
});
