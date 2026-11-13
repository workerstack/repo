import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { expect, it } from "vitest";

import { HEADER, context } from "../__fixtures__/release-context.ts";
import type { Pack } from "../config.ts";
import { evalWorkflow } from "./eval-workflow.ts";
import { GENERATORS } from "./outputs.ts";

const PATH = ".github/workflows/eval.yml";
const CHECKOUT = "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1";
const SETUP_BUN = "oven-sh/setup-bun@0c5077e51419868618aeaa5fe8019c62421857d6 # v2.2.0";
const CACHE = "55cc8345863c7cc4c66a329aec7e433d2d1c52a9 # v6.1.0";
const UPLOAD = "actions/upload-artifact@cf430e030ddbb5b0abf93d22962f4752f3646cd9 # v7.0.2";
const EVALS: Pack[] = ["evals"];

/**
 * Dispatched by hand with an eval name and a cap. The one job waits in the evals environment for its reviewer, keeps
 * the answer cache between runs, runs the eval with the key, and uploads the spend summary even when a case fails.
 */
const EVAL_YML = `name: eval

on:
  workflow_dispatch:
    inputs:
      eval:
        description: The eval's name under evals
        required: true
        type: string
      max-cost:
        description: The most the run may spend, in US dollars
        required: true
        type: string
        default: "1"

concurrency:
  group: eval-\${{ inputs.eval }}
  cancel-in-progress: false

permissions:
  contents: read

jobs:
  eval:
    runs-on: ubuntu-latest
    timeout-minutes: 30
    environment: evals
    steps:
      - uses: ${CHECKOUT}
      - uses: ${SETUP_BUN}
        with:
          bun-version-file: package.json
      - run: bun install --frozen-lockfile
      - uses: actions/cache/restore@${CACHE}
        with:
          path: .repo/tmp/evals/cache
          key: evals-\${{ inputs.eval }}-\${{ github.run_id }}
          restore-keys: evals-\${{ inputs.eval }}-
      - name: Run the eval
        shell: bash
        env:
          ANTHROPIC_API_KEY: \${{ secrets.ANTHROPIC_API_KEY }}
          EVAL: \${{ inputs.eval }}
          MAX_COST: \${{ inputs.max-cost }}
        run: bun repo eval "$EVAL" --max-cost "$MAX_COST"
      - uses: actions/cache/save@${CACHE}
        if: always()
        with:
          path: .repo/tmp/evals/cache
          key: evals-\${{ inputs.eval }}-\${{ github.run_id }}
      - uses: ${UPLOAD}
        if: always()
        with:
          name: eval-\${{ inputs.eval }}
          path: .repo/tmp/evals/runs
          if-no-files-found: ignore
`;

it("is a generator", () => {
  expect(GENERATORS).toContain(evalWorkflow);
});

it("writes nothing with the evals pack off", () => {
  const off = evalWorkflow(context(["agents", "standards", "docs", "release", "workspace", "benchmark"]));
  expect(off).toStrictEqual({ errors: [], outputs: [] });
});

it("writes the whole eval.yml with the pack on, over one it wrote before", () => {
  const written = {
    errors: [],
    outputs: [{ content: EVAL_YML, kind: "file", managed: "whole", path: PATH, tracked: true }],
  };

  expect(evalWorkflow(context(EVALS))).toStrictEqual(written);
  expect(evalWorkflow(context(EVALS, {}, { [PATH]: `${HEADER}\nname: eval\n` }))).toStrictEqual(written);
});

it("refuses a hand-written eval.yml", () => {
  expect(evalWorkflow(context(EVALS, {}, { [PATH]: "name: mine\n" }))).toStrictEqual({
    errors: [`${PATH} is hand-written; delete it so repo sync can own it`],
    outputs: [],
  });
});

it("names ANTHROPIC_API_KEY in no checked-in workflow but eval.yml", () => {
  const dir = fileURLToPath(new URL("../../.github/workflows", import.meta.url));
  const others = fs.readdirSync(dir).filter((name) => name !== "eval.yml");
  expect(others.length).toBeGreaterThan(0);
  const leaks = others.filter((name) => fs.readFileSync(path.join(dir, name), "utf8").includes("ANTHROPIC_API_KEY"));
  expect(leaks).toStrictEqual([]);
});
