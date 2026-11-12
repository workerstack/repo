import { UPLOAD } from "./release.constants.ts";

export const BENCH_PATH: string = ".github/workflows/bench.yml";
/** One OS runs a spec's warmup and runs in minutes; an hour leaves room for a slow candidate and a cold runner. */
const BENCH_TIMEOUT_MINUTES: number = 60;

/** The workflow text before the steps: dispatch inputs, concurrency, permissions and the one job's os matrix. */
export const BENCH_PREAMBLE: string = `name: bench

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
    timeout-minutes: ${BENCH_TIMEOUT_MINUTES}
    strategy:
      fail-fast: false
      matrix:
        os: \${{ fromJSON(inputs.os) }}
    steps:`;

/** Checkout at the dispatched commit; the spec name reaches the shell only through env, never inside run. */
export const BENCH_CHECKOUT_WITH: string = `        with:
          ref: \${{ inputs.sha }}`;

export const BENCH_STEPS: string = `      - name: Run the spec
        shell: bash
        env:
          SPEC: \${{ inputs.spec }}
        run: bun repo bench "$SPEC"
      - uses: ${UPLOAD}
        with:
          name: bench-\${{ inputs.spec }}-\${{ matrix.os }}
          path: .repo/tmp/bench/\${{ inputs.spec }}/\${{ matrix.os }}.json
          if-no-files-found: error`;
