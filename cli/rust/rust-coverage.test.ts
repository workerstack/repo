import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import type { CargoResult, CargoRun } from "./clippy.ts";
import { rustCoverage, rustFloorProblems } from "./rust-coverage.ts";

const ROOT = "/r";
const metric = (percent: number) => ({ count: 9, covered: 6, percent });
const file = (filename: string, [lines, functions, regions]: [number, number, number]) => ({
  filename,
  summary: { branches: metric(0), lines: metric(lines), functions: metric(functions), regions: metric(regions) },
});
const report = (...files: unknown[]) => ({ type: "llvm.coverage.json.export", data: [{ files, totals: {} }] });

/** A fake cargo that writes `json` to the `--output-path` it is given and exits with `over`. */
const writing =
  (json: string, over: Partial<CargoResult> = {}, seen: string[][] = []): CargoRun =>
  (_root, args) => {
    seen.push([...args]);
    fs.writeFileSync(args[args.indexOf("--output-path") + 1] ?? "", json);
    return { status: 0, stdout: "", stderr: "", missing: false, ...over };
  };

it("runs llvm-cov nextest locked over the workspace into a temp file", () => {
  const seen: string[][] = [];
  rustCoverage(ROOT, writing(JSON.stringify(report()), {}, seen));
  const args = seen[0] ?? [];
  expect(args.slice(0, 8)).toStrictEqual([
    "llvm-cov",
    "nextest",
    "--locked",
    "--workspace",
    "--no-tests=warn",
    "--json",
    "--summary-only",
    "--output-path",
  ]);
  expect(fs.existsSync(args[8] ?? "")).toBe(false);
});

it("keys rows by root-relative POSIX path with floored percents", () => {
  const json = JSON.stringify(
    report(file("/r/a/src/lib.rs", [66.67, 66.67, 58.33]), file("/r/b/src/main.rs", [0, 0, 0])),
  );
  expect(rustCoverage(ROOT, writing(json))).toStrictEqual({
    ok: true,
    value: {
      "a/src/lib.rs": { lines: 66, functions: 66, regions: 58 },
      "b/src/main.rs": { lines: 0, functions: 0, regions: 0 },
    },
  });
});

it("reads a backslash filename and drops a file outside the root", () => {
  const json = JSON.stringify(report(file("\\r\\a\\src\\lib.rs", [100, 100, 100]), file("/elsewhere/x.rs", [1, 1, 1])));
  expect(rustCoverage(ROOT, writing(json))).toStrictEqual({
    ok: true,
    value: { "a/src/lib.rs": { lines: 100, functions: 100, regions: 100 } },
  });
});

it("matches a root given with a trailing slash, or through a symlink", () => {
  const real = fs.realpathSync(os.tmpdir());
  const json = JSON.stringify(report(file(`${real}/a.rs`, [50, 50, 50])));
  const value = { "a.rs": { lines: 50, functions: 50, regions: 50 } };
  expect(rustCoverage(`${real}/`, writing(json))).toStrictEqual({ ok: true, value });
  const link = path.join(fs.mkdtempSync(path.join(real, "link-")), "to");
  fs.symlinkSync(real, link);
  expect(rustCoverage(link, writing(json))).toStrictEqual({ ok: true, value });
  fs.rmSync(path.dirname(link), { recursive: true, force: true });
});

it("carries the output of a run that exits nonzero", () => {
  const run = writing("", { status: 100, stdout: "FAIL tests::adds\n", stderr: "1 test run: 0 passed\n" });
  const got = rustCoverage(ROOT, run);
  expect(got).toStrictEqual({
    ok: false,
    errors: ["cargo llvm-cov exited 100:\nFAIL tests::adds\n1 test run: 0 passed"],
  });
});

it("says cargo is missing", () => {
  const got = rustCoverage(ROOT, () => ({ status: 1, stdout: "", stderr: "", missing: true }));
  expect(got.ok ? "" : got.errors[0]).toContain("cargo is not on PATH");
});

it("says a signal ended the run", () => {
  const got = rustCoverage(ROOT, writing("", { status: null }));
  expect(got.ok ? "" : got.errors[0]).toContain("cargo llvm-cov exited null");
});

it("quotes a report that is not there, not JSON or not the shape", () => {
  const none: CargoRun = () => ({ status: 0, stdout: "", stderr: "", missing: false });
  const absent = rustCoverage(ROOT, none);
  expect(absent.ok ? "" : absent.errors[0]).toContain("cargo llvm-cov wrote no report repo can read");
  const text = rustCoverage(ROOT, writing("not json at all"));
  expect(text.ok ? "" : text.errors[0]).toContain("not json at all");
  const shape = rustCoverage(ROOT, writing('{"data":[]}'));
  expect(shape.ok ? "" : shape.errors[0]).toContain('{"data":[]}');
});

it("names every metric below its floor", () => {
  const rows = {
    "a/src/lib.rs": { lines: 66, functions: 70, regions: 58 },
    "b.rs": { lines: 1, functions: 1, regions: 1 },
  };
  const floors = { "a/src/lib.rs": { lines: 80, functions: 70, regions: 60 } };
  expect(rustFloorProblems(rows, floors)).toStrictEqual([
    "rust coverage: a/src/lib.rs lines 66 is below its floor 80; add tests or restore the code",
    "rust coverage: a/src/lib.rs regions 58 is below its floor 60; add tests or restore the code",
  ]);
});

it("passes rows at or above their floors and ignores a floor that is not a rust row", () => {
  const rows = { "a.rs": { lines: 80, functions: 80, regions: 80 } };
  expect(rustFloorProblems(rows, { "a.rs": { lines: 80, functions: 79, regions: 1 } })).toStrictEqual([]);
  const ts = { statements: 99, branches: 99, functions: 99, lines: 99 };
  expect(rustFloorProblems(rows, { "a.rs": ts })).toStrictEqual([]);
});
