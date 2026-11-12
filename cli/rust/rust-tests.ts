import path from "node:path";

import { z } from "zod";

import { tryJson } from "../json.ts";
import { fail, pass, plural, type Gate } from "../scripts/ci-gate.ts";
import type { Result } from "../scripts/lint-baseline.ts";
import { LLVM_COV_PIN, NEXTEST_PIN } from "./cargo-tools.constants.ts";
import { pinProblem, quote } from "./cargo-tools.ts";
import { MISSING_CARGO } from "./clippy.constants.ts";
import type { CargoResult, CargoRun } from "./clippy.ts";
import { readFloorsFile, type Floors, type RustFloor } from "./floors.ts";
import { rustCoverage, rustFloorProblems } from "./rust-coverage.ts";
import {
  DOCTEST_ARGS,
  DOCTEST_PASSED,
  FAILED_LABEL,
  METADATA_ARGS,
  NEXTEST_ARGS,
  NEXTEST_PASSED,
} from "./rust-tests.constants.ts";

/** What the gate runs with: cargo, whether to measure coverage, and the floors file to hold when it does. */
type Deps = { run: CargoRun; coverage: boolean; floors: string };

/** What the test run left: its output (for the counts) and, under coverage, the per-file rows. */
type Tested = { text: string; rows: Record<string, RustFloor> | null };

function outputOf(result: CargoResult): string {
  return `${result.stdout}${result.stderr}`;
}

function failed(lines: string[]): Gate {
  return fail(FAILED_LABEL, lines);
}

/** The first pin problem of the tools this run needs: nextest always, llvm-cov only under coverage. */
function pinLine(root: string, deps: Deps): string | null {
  const pins = deps.coverage ? [NEXTEST_PIN, LLVM_COV_PIN] : [NEXTEST_PIN];

  for (const pin of pins) {
    const problem = pinProblem(root, deps.run, pin);

    if (problem !== null) return problem;
  }

  return null;
}

/** The tests under llvm-cov, keeping the output of the run that rustCoverage keeps no copy of. */
function measured(root: string, run: CargoRun): Result<Tested> {
  let text = "";

  const result = rustCoverage(root, (dir, args) => {
    const ran = run(dir, args);
    text = outputOf(ran);

    return ran;
  });

  return result.ok ? { ok: true, value: { rows: result.value, text } } : result;
}

/** The tests under plain nextest. */
function plain(root: string, run: CargoRun): Result<Tested> {
  const result = run(root, NEXTEST_ARGS);

  if (result.missing) return { errors: [MISSING_CARGO], ok: false };
  const text = outputOf(result);

  return result.status === 0 ? { ok: true, value: { rows: null, text } } : { errors: [text.trim()], ok: false };
}

/** The shape of `cargo metadata --no-deps` this reads, built once per run so the module runs no code. */
function schema() {
  const target = z.object({ doctest: z.boolean() });

  return z.object({
    packages: z.array(z.object({ id: z.string(), targets: z.array(target) })),
    workspace_members: z.array(z.string()),
  });
}

/** Whether a workspace member has a target cargo runs doctests of; or why that cannot be told. */
function hasDoctests(root: string, run: CargoRun): Result<boolean> {
  const result = run(root, METADATA_ARGS);

  if (result.missing) return { errors: [MISSING_CARGO], ok: false };

  if (result.status !== 0) {
    return {
      errors: [`cargo metadata exited ${result.status}: ${quote(outputOf(result))}`],
      ok: false,
    };
  }

  const parsed = tryJson(schema(), result.stdout);

  if (parsed === undefined) {
    return {
      errors: [`cargo metadata printed output repo cannot read: ${quote(result.stdout)}`],
      ok: false,
    };
  }

  const members = new Set(parsed.workspace_members);
  const value = parsed.packages.some((pkg) => members.has(pkg.id) && pkg.targets.some((t) => t.doctest));

  return { ok: true, value };
}

/** The doctests' passed count, or null when no crate has any to run. */
function doctests(root: string, run: CargoRun): Result<number | null> {
  const found = hasDoctests(root, run);

  if (!found.ok) return found;

  if (!found.value) return { ok: true, value: null };
  const result = run(root, DOCTEST_ARGS);

  if (result.missing) return { errors: [MISSING_CARGO], ok: false };
  const text = outputOf(result);

  if (result.status !== 0) return { errors: [text.trim()], ok: false };
  const counts = [...text.matchAll(DOCTEST_PASSED)].map((match) => Number(match[1]));

  return { ok: true, value: counts.reduce((sum, count) => sum + count, 0) };
}

/** The floors of `file` held against `rows`: one line per metric below its floor, or why the file cannot be read. */
function floorLines(file: string, rows: Record<string, RustFloor>): string[] {
  let floors: Floors;

  try {
    floors = readFloorsFile(file);
  } catch (error) {
    return [(error /* readFloorsFile throws Errors with a message */ as Error).message];
  }

  return rustFloorProblems(rows, floors);
}

/**
 * The `rust tests` gate at `root`: the pins first, then the tests (under llvm-cov when `coverage`, else plain nextest),
 * then the doctests when a workspace target has any, then every `.rs` floor of the `floors` file under coverage. The
 * first stage to fail ends the gate with its lines under it.
 */
export function rustTests(root: string, deps: Deps): Gate {
  const problem = pinLine(root, deps);

  if (problem !== null) return failed([problem]);
  const tested = deps.coverage ? measured(root, deps.run) : plain(root, deps.run);

  if (!tested.ok) return failed(tested.errors);
  const docs = doctests(root, deps.run);

  if (!docs.ok) return failed(docs.errors);
  const lines = tested.value.rows === null ? [] : floorLines(path.resolve(root, deps.floors), tested.value.rows);

  if (lines.length > 0) return failed(lines);
  const passed = Number(NEXTEST_PASSED.exec(tested.value.text)?.[1] ?? 0);
  const parts = [plural(passed, "test"), ...(docs.value === null ? [] : [plural(docs.value, "doctest")])];

  return pass(`rust tests ok (${parts.join(", ")})`);
}
