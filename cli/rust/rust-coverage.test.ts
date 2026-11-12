import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { expect, it } from "vitest";

import type { CargoResult, CargoRun } from "./clippy.ts";
import { rustCoverage, rustFloorProblems } from "./rust-coverage.ts";

const ROOT = "/r";

function metric(percent: number) {
  return { count: 9, covered: 6, percent };
}

function file(filename: string, [lines, functions, regions]: [number, number, number]) {
  return {
    filename,
    summary: { branches: metric(0), functions: metric(functions), lines: metric(lines), regions: metric(regions) },
  };
}

function report(...files: unknown[]) {
  return { data: [{ files, totals: {} }], type: "llvm.coverage.json.export" };
}

function none(): CargoResult {
  return { missing: false, status: 0, stderr: "", stdout: "" };
}

/** A fake cargo that writes `json` to the `--output-path` it is given and exits with `over`. */
function writing(json: string, over: Partial<CargoResult> = {}, seen: string[][] = []): CargoRun {
  return (_root, args) => {
    seen.push([...args]);
    fs.writeFileSync(args[args.indexOf("--output-path") + 1] ?? "", json);

    return { missing: false, status: 0, stderr: "", stdout: "", ...over };
  };
}

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
      "a/src/lib.rs": { functions: 66, lines: 66, regions: 58 },
      "b/src/main.rs": { functions: 0, lines: 0, regions: 0 },
    },
  });
});

it("reads a backslash filename and drops a file outside the root", () => {
  const json = JSON.stringify(report(file("\\r\\a\\src\\lib.rs", [100, 100, 100]), file("/elsewhere/x.rs", [1, 1, 1])));
  expect(rustCoverage(ROOT, writing(json))).toStrictEqual({
    ok: true,
    value: { "a/src/lib.rs": { functions: 100, lines: 100, regions: 100 } },
  });
});

it("matches a root given with a trailing slash, or through a symlink", () => {
  const real = fs.realpathSync(os.tmpdir());
  const json = JSON.stringify(report(file(`${real}/a.rs`, [50, 50, 50])));
  const value = { "a.rs": { functions: 50, lines: 50, regions: 50 } };
  expect(rustCoverage(`${real}/`, writing(json))).toStrictEqual({ ok: true, value });
  const link = path.join(fs.mkdtempSync(path.join(real, "link-")), "to");
  fs.symlinkSync(real, link);
  expect(rustCoverage(link, writing(json))).toStrictEqual({ ok: true, value });
  fs.rmSync(path.dirname(link), { force: true, recursive: true });
});

it("carries the output of a run that exits nonzero", () => {
  const run = writing("", { status: 100, stderr: "1 test run: 0 passed\n", stdout: "FAIL tests::adds\n" });
  const got = rustCoverage(ROOT, run);
  expect(got).toStrictEqual({
    error: ["cargo llvm-cov exited 100:\nFAIL tests::adds\n1 test run: 0 passed"],
    ok: false,
  });
});

it("says cargo is missing", () => {
  const got = rustCoverage(ROOT, () => ({ missing: true, status: 1, stderr: "", stdout: "" }));
  expect(got.ok ? "" : got.error[0]).toContain("cargo is not on PATH");
});

it("says a signal ended the run", () => {
  const got = rustCoverage(ROOT, writing("", { status: null }));
  expect(got.ok ? "" : got.error[0]).toContain("cargo llvm-cov exited null");
});

it("quotes a report that is not there, not JSON or not the shape", () => {
  const absent = rustCoverage(ROOT, none);
  expect(absent.ok ? "" : absent.error[0]).toContain("cargo llvm-cov wrote no report repo can read");
  const text = rustCoverage(ROOT, writing("not json at all"));
  expect(text.ok ? "" : text.error[0]).toContain("not json at all");
  const noData = rustCoverage(ROOT, writing('{"data":[]}'));
  expect(noData.ok ? "" : noData.error[0]).toContain('{"data":[]}');
});

it("names every metric below its floor", () => {
  const rows = {
    "a/src/lib.rs": { functions: 70, lines: 66, regions: 58 },
    "b.rs": { functions: 1, lines: 1, regions: 1 },
  };

  const floors = { "a/src/lib.rs": { functions: 70, lines: 80, regions: 60 } };
  expect(rustFloorProblems(rows, floors)).toStrictEqual([
    "rust coverage: a/src/lib.rs lines 66 is below its floor 80; add tests or restore the code",
    "rust coverage: a/src/lib.rs regions 58 is below its floor 60; add tests or restore the code",
  ]);
});

it("passes rows at or above their floors and ignores a floor that is not a rust row", () => {
  const rows = { "a.rs": { functions: 80, lines: 80, regions: 80 } };
  expect(rustFloorProblems(rows, { "a.rs": { functions: 79, lines: 80, regions: 1 } })).toStrictEqual([]);
  const ts = { branches: 99, functions: 99, lines: 99, statements: 99 };
  expect(rustFloorProblems(rows, { "a.rs": ts })).toStrictEqual([]);
});
