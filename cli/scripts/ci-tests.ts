/** The `repo ci` tests gate: one `vitest run`, with coverage unless asked otherwise. */
import fs from "node:fs";
import path from "node:path";
import { RUST_MANIFEST } from "../rust/rust-tests.constants.ts";
import { fail, pass, plural, textOf, type Gate } from "./ci-gate.ts";
import { REPORT_OUTPUT_FLAG, REPORT_REPORTERS } from "./ci-skips.constants.ts";
import {
  NO_TEST_FILES_LABEL,
  PASS_WITH_NO_TESTS_FLAG,
  VITEST_RUN_ARGS,
  VITEST_RUN_NO_COVERAGE_ARGS,
} from "./ci.constants.ts";
import { countsOfRun, type Bins } from "./turn-steps.ts";

/** What the gate needs of the run: the root, the vitest bin, whether coverage is on and where the json report goes. */
export type TestsCtx = { root: string; bins: Bins; coverage: boolean; json: string | undefined };

/** Under a root Cargo.toml the tests may all be Rust ones, so no vitest test file is no failure. */
export function testsGate(ctx: TestsCtx): Gate {
  const reporting = ctx.json === undefined ? [] : [...REPORT_REPORTERS, `${REPORT_OUTPUT_FLAG}${ctx.json}`];
  const base = ctx.coverage ? VITEST_RUN_ARGS : VITEST_RUN_NO_COVERAGE_ARGS;
  const rustRepo = fs.existsSync(path.join(ctx.root, RUST_MANIFEST));
  const lenient = rustRepo ? [PASS_WITH_NO_TESTS_FLAG] : [];
  const run = ctx.bins.vitest([...base, ...lenient, ...reporting], ctx.root);
  if (run === null) return pass("tests skipped (no vitest in .)", false);
  const counts = countsOfRun(run);
  if (run.code === 0 && rustRepo && counts.total === 0) return pass(NO_TEST_FILES_LABEL);
  if (run.code === 0) return pass(`${plural(counts.passed, "test")} passed`);
  const detail = counts.failed > 0 ? ` (${counts.failed} failed, ${counts.passed} passed)` : "";
  return fail(`tests failed${detail}`, [textOf(run)]);
}
