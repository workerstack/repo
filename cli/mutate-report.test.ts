import { expect, it } from "vitest";
import { fromCargoMutants, parseReport } from "./mutate-report.ts";

const span = (line: number, column: number) => ({
  start: { line, column },
  end: { line, column: column + 1 },
});

/** One outcomes.json entry, shaped as cargo-mutants 27.1.0 writes it (trimmed of phase results). */
function mutant(file: string, summary: string, at: { line?: number; genre?: string } = {}) {
  const { line = 1, genre = "BinaryOperator" } = at;
  const name = `${file}:${line}:5: replace + with - in f`;
  const scenario = {
    Mutant: {
      name,
      package: "p",
      file,
      span: span(line, 5),
      replacement: "-",
      genre,
    },
  };
  return {
    scenario,
    summary,
    log_path: "log/x.log",
    diff_path: "diff/x.diff",
    phase_results: [],
  };
}
const baseline = {
  scenario: "Baseline",
  summary: "Success",
  log_path: "log/baseline.log",
  diff_path: null,
};
const outcomes = (...entries: unknown[]) => ({
  outcomes: entries,
  total_mutants: entries.length,
});

it("counts caught and timeout mutants as killed, per file", () => {
  const raw = outcomes(
    mutant("crates/a/src/lib.rs", "CaughtMutant"),
    mutant("crates/a/src/lib.rs", "Timeout", { line: 2 }),
    mutant("crates/b/src/lib.rs", "CaughtMutant"),
  );
  expect(fromCargoMutants(raw)).toEqual({
    ok: true,
    value: {
      "crates/a/src/lib.rs": { killed: 2, survivors: [] },
      "crates/b/src/lib.rs": { killed: 1, survivors: [] },
    },
  });
});

it("makes a missed mutant a survivor at its span start, named by its genre", () => {
  const raw = outcomes(mutant("crates/a/src/lib.rs", "MissedMutant", { line: 16, genre: "FnValue" }));
  expect(fromCargoMutants(raw)).toEqual({
    ok: true,
    value: {
      "crates/a/src/lib.rs": {
        killed: 0,
        survivors: [{ line: 16, column: 5, mutator: "FnValue", status: "Survived" }],
      },
    },
  });
});

it("leaves out unviable mutants, the baseline and a failed baseline", () => {
  const raw = outcomes(
    baseline,
    {
      scenario: { Failure: 100 },
      summary: "Failure",
      log_path: "log/baseline.log",
      diff_path: null,
    },
    mutant("crates/a/src/lib.rs", "Unviable"),
    mutant("crates/a/src/lib.rs", "CaughtMutant", { line: 3 }),
  );
  expect(fromCargoMutants(raw)).toEqual({
    ok: true,
    value: { "crates/a/src/lib.rs": { killed: 1, survivors: [] } },
  });
});

it("gives no files when only the baseline ran", () => {
  expect(fromCargoMutants(outcomes(baseline))).toEqual({ ok: true, value: {} });
});

it("names a bad shape", () => {
  const none = fromCargoMutants({ files: {} });
  expect(none).toMatchObject({ ok: false });
  expect(!none.ok && none.reason).toContain("outcomes");
  const entry = fromCargoMutants(
    outcomes({
      scenario: { Mutant: { file: "a.rs" } },
      summary: "CaughtMutant",
    }),
  );
  expect(entry.ok).toBe(false);
});

it("requires the tool in a shard report", () => {
  const base = { head: "abc", shard: { index: 1, total: 1 }, files: {} };
  expect(parseReport(JSON.stringify(base))).toMatchObject({ ok: false });
  const bad = parseReport(JSON.stringify({ ...base, tool: "jest" }));
  expect(bad.ok).toBe(false);
  for (const tool of ["stryker", "cargo-mutants"]) {
    expect(parseReport(JSON.stringify({ ...base, tool }))).toEqual({
      ok: true,
      value: { ...base, tool },
    });
  }
  expect(parseReport("{")).toMatchObject({ ok: false });
});
