import { CACHE_PIN, UPLOAD } from "./release.constants.ts";

export const EVAL_PATH: string = ".github/workflows/eval.yml";

/** One eval's cases at a few seconds each; half an hour leaves room for a slow model and a cold runner. */
const EVAL_TIMEOUT_MINUTES: number = 30;

/** Where `repo eval` keeps answers, and where it writes each run's spend summary. */
const CACHE_DIR: string = ".repo/tmp/evals/cache";
const RUNS_DIR: string = ".repo/tmp/evals/runs";

/** A new key each run, so a run's answers are saved; the prefix restores the newest earlier run's cache. */
const CACHE_PREFIX: string = "evals-${{ inputs.eval }}-";
const CACHE_KEY: string = `${CACHE_PREFIX}\${{ github.run_id }}`;

/**
 * The workflow text before the steps: dispatch inputs, concurrency, permissions, and the one job in the `evals`
 * environment, which waits for its reviewer and holds the key.
 */
export const EVAL_PREAMBLE: string = `name: eval

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
    timeout-minutes: ${EVAL_TIMEOUT_MINUTES}
    environment: evals
    steps:`;

export const EVAL_RESTORE_STEP: string = `      - uses: actions/cache/restore@${CACHE_PIN}
        with:
          path: ${CACHE_DIR}
          key: ${CACHE_KEY}
          restore-keys: ${CACHE_PREFIX}`;

/** The key reaches only this step; the eval name and cap reach the shell only through env, never inside run. */
export const EVAL_RUN_STEP: string = `      - name: Run the eval
        shell: bash
        env:
          ANTHROPIC_API_KEY: \${{ secrets.ANTHROPIC_API_KEY }}
          EVAL: \${{ inputs.eval }}
          MAX_COST: \${{ inputs.max-cost }}
        run: bun repo eval "$EVAL" --max-cost "$MAX_COST"`;

/** Saved and uploaded even when a case fails or the cap stops the run, so paid answers and the summary are kept. */
export const EVAL_KEEP_STEPS: string = `      - uses: actions/cache/save@${CACHE_PIN}
        if: always()
        with:
          path: ${CACHE_DIR}
          key: ${CACHE_KEY}
      - uses: ${UPLOAD}
        if: always()
        with:
          name: eval-\${{ inputs.eval }}
          path: ${RUNS_DIR}
          if-no-files-found: ignore`;
