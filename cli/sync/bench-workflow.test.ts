import { expect, it } from "vitest";

import { HEADER, context } from "../__fixtures__/release-context.ts";
import type { Pack } from "../config.ts";
import { benchWorkflow } from "./bench-workflow.ts";
import { GENERATORS } from "./outputs.ts";

const PATH = ".github/workflows/bench.yml";
const CHECKOUT = "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1";
const SETUP_BUN = "oven-sh/setup-bun@0c5077e51419868618aeaa5fe8019c62421857d6 # v2.2.0";
const UPLOAD = "actions/upload-artifact@cf430e030ddbb5b0abf93d22962f4752f3646cd9 # v7.0.2";
const BENCHMARK: Pack[] = ["benchmark"];

/**
 * Dispatched by `repo bench --remote` with the spec, the OSes as a JSON array and the commit. Each OS checks out that
 * commit, runs the spec, and uploads its raw result as `bench-<spec>-<os>`. Inputs reach the shell only through env.
 */
const BENCH_YML = `name: bench

on:
  workflow_dispatch:
    inputs:
      spec:
        description: The spec's name under .repo/bench
        required: true
        type: string
      os:
        description: The runner labels to measure on, as a JSON array
        required: true
        type: string
      sha:
        description: The commit to check out and measure
        required: true
        type: string

concurrency:
  group: bench-\${{ inputs.spec }}-\${{ inputs.sha }}
  cancel-in-progress: false

permissions:
  contents: read

jobs:
  bench:
    runs-on: \${{ matrix.os }}
    timeout-minutes: 60
    strategy:
      fail-fast: false
      matrix:
        os: \${{ fromJSON(inputs.os) }}
    steps:
      - uses: ${CHECKOUT}
        with:
          ref: \${{ inputs.sha }}
      - uses: ${SETUP_BUN}
        with:
          bun-version-file: package.json
      - run: bun install --frozen-lockfile
      - name: Run the spec
        shell: bash
        env:
          SPEC: \${{ inputs.spec }}
        run: bun repo bench "$SPEC"
      - uses: ${UPLOAD}
        with:
          name: bench-\${{ inputs.spec }}-\${{ matrix.os }}
          path: .repo/tmp/bench/\${{ inputs.spec }}/\${{ matrix.os }}.json
          if-no-files-found: error
`;

it("is a generator", () => {
  expect(GENERATORS).toContain(benchWorkflow);
});

it("writes nothing with the benchmark pack off", () => {
  expect(benchWorkflow(context(["agents", "standards", "docs", "release", "workspace"]))).toStrictEqual({
    errors: [],
    outputs: [],
  });
});

it("writes the whole bench.yml with the pack on", () => {
  expect(benchWorkflow(context(BENCHMARK))).toStrictEqual({
    errors: [],
    outputs: [{ content: BENCH_YML, kind: "file", managed: "whole", path: PATH, tracked: true }],
  });
});

it("passes no input straight into a run line, so a crafted spec name cannot inject shell", () => {
  const [output] = benchWorkflow(context(BENCHMARK)).outputs;

  const runs = (output?.kind === "file" ? output.content : "")
    .split("\n")
    .filter((line) => /^\s+(?:- )?run:/.test(line));

  expect(runs.length).toBeGreaterThan(0);

  for (const line of runs) expect(line).not.toContain("${{");
});

it("rewrites a bench.yml that has the generated header on its first line", () => {
  const result = benchWorkflow(context(BENCHMARK, {}, { [PATH]: `${HEADER}\nname: old\n` }));
  expect(result.errors).toStrictEqual([]);
  expect(result.outputs).toHaveLength(1);
});

it("refuses a hand-written bench.yml", () => {
  expect(benchWorkflow(context(BENCHMARK, {}, { [PATH]: "name: bench\n" }))).toStrictEqual({
    errors: [".github/workflows/bench.yml is hand-written; delete it so repo sync can own it"],
    outputs: [],
  });
});
