/**
 * The `repo ci` tests gate: one `vitest run`, with coverage unless asked otherwise, of all tests or one slice, then
 * the node run, whole, when the root holds a node config and the slice is the first.
 */
import fs from "node:fs";
import path from "node:path";

import { RUST_MANIFEST } from "../rust/rust-tests.constants.ts";
import { fail, pass, plural, skip, textOf, type Gate } from "./ci-gate.ts";
import { REPORT_OUTPUT_FLAG, REPORT_REPORTERS } from "./ci-skips.constants.ts";
import {
  BLOB_DIR,
  BLOB_OUTPUT_FLAG,
  BLOB_REPORTER_FLAG,
  DEFAULT_REPORTER_FLAG,
  NO_THRESHOLDS_FLAG,
  NO_TEST_FILES_LABEL,
  PASS_WITH_NO_TESTS_FLAG,
  VITEST_RUN_ARGS,
  VITEST_RUN_NO_COVERAGE_ARGS,
  SHARD_WITH_FLOORS_NOTE,
  VITEST_SHARD_FLAG,
} from "./ci.constants.ts";
import type { Captured } from "./lint.ts";
import { nodeReport, testRuns } from "./node-run.ts";
import { summedCounts } from "./test-counts.ts";
import type { Bins } from "./turn-steps.ts";

/**
 * What the gate needs of the run: the root, the vitest bin, whether coverage is on, where the json report goes and
 * the `i/n` slice of the test files to run, if only one.
 */
export type TestsCtx = {
  root: string;
  bins: Bins;
  coverage: boolean;
  json: string | undefined;
  shard?: string | undefined;
};

/**
 * The flags of a coverage shard: its blob for `repo ci merge` and no floors, which the merged run checks. vitest
 * replaces the configured reporters when given any, so the default one is named unless the json report already does.
 */
function blobArgs(ctx: TestsCtx, shard: string): string[] {
  const [i, n] = shard.split("/");
  const blob = path.join(ctx.root, BLOB_DIR, `blob-${i}-${n}.json`);
  const kept = ctx.json === undefined ? [DEFAULT_REPORTER_FLAG] : [];

  return [...kept, BLOB_REPORTER_FLAG, `${BLOB_OUTPUT_FLAG}${blob}`, NO_THRESHOLDS_FLAG];
}

/**
 * vitest's args: coverage or not, the slice, and the json report. Under a root Cargo.toml the tests may all be Rust
 * ones, and a slice may hold no test file, so either way no vitest test file is no failure.
 */
function vitestArgs(ctx: TestsCtx, { rustRepo }: { rustRepo: boolean }): string[] {
  const reporting = ctx.json === undefined ? [] : [...REPORT_REPORTERS, `${REPORT_OUTPUT_FLAG}${ctx.json}`];
  const base = ctx.coverage ? VITEST_RUN_ARGS : VITEST_RUN_NO_COVERAGE_ARGS;
  const slice = ctx.shard === undefined ? [] : [`${VITEST_SHARD_FLAG}${ctx.shard}`];
  const lenient = rustRepo || ctx.shard !== undefined ? [PASS_WITH_NO_TESTS_FLAG] : [];
  const blob = ctx.coverage && ctx.shard !== undefined ? blobArgs(ctx, ctx.shard) : [];

  return [...base, ...slice, ...lenient, ...reporting, ...blob];
}

/** The tests line's note on the slice, and on the floors a coverage slice leaves to the merge. */
function shardNote(ctx: TestsCtx): string {
  if (ctx.shard === undefined) return "";

  return ctx.coverage ? ` (shard ${ctx.shard}, ${SHARD_WITH_FLOORS_NOTE})` : ` (shard ${ctx.shard})`;
}

/**
 * The node run's args: whole, with its own floors and no blob, since `repo ci merge` merges only the main run's
 * slices; its json report goes beside the main one.
 */
function nodeArgs(ctx: TestsCtx): string[] {
  const reporting = ctx.json === undefined ? [] : [...REPORT_REPORTERS, `${REPORT_OUTPUT_FLAG}${nodeReport(ctx.json)}`];

  return [...(ctx.coverage ? VITEST_RUN_ARGS : VITEST_RUN_NO_COVERAGE_ARGS), ...reporting];
}

/** Whether this run holds the node run: the root has a node config, and this is the whole run or its first slice. */
function runsNode(ctx: TestsCtx): boolean {
  return testRuns(ctx.root).includes("node") && (ctx.shard === undefined || ctx.shard.startsWith("1/"));
}

/** One `vitest run` and the node run; a Rust repo with no vitest test file passes, and a slice's line names it. */
export async function testsGate(ctx: TestsCtx): Promise<Gate> {
  const rustRepo = fs.existsSync(path.join(ctx.root, RUST_MANIFEST));
  const main = await ctx.bins.vitest(vitestArgs(ctx, { rustRepo }), ctx.root, "main");

  if (main === null) return skip("tests skipped (no vitest in .)");
  const node = runsNode(ctx) ? await ctx.bins.vitest(nodeArgs(ctx), ctx.root, "node") : null;
  const runs: Captured[] = node === null ? [main] : [main, node];
  const counts = summedCounts(runs);
  const named = shardNote(ctx);
  const bad = runs.filter((run) => run.code !== 0);

  if (bad.length === 0 && rustRepo && counts.total === 0) return pass(`${NO_TEST_FILES_LABEL}${named}`);

  if (bad.length === 0) return pass(`${plural(counts.passed, "test")} passed${named}`);
  const detail = counts.failed > 0 ? ` (${counts.failed} failed, ${counts.passed} passed)` : "";

  return fail(`tests failed${detail}${named}`, bad.map(textOf));
}
