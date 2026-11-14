/** The test counts vitest's default reporter prints, read from a run's output and summed over runs. */
import type { Captured } from "./lint.ts";

const TESTS_LINE = /^\s*Tests\s+(.*)$/m;
const FAILED_COUNT = /(\d+) failed/;
const PASSED_COUNT = /(\d+) passed/;
const TOTAL_COUNT = /\((\d+)\)/;

export type Counts = { passed: number; failed: number; total: number };

/** vitest's `Tests  1 failed | 3 passed (4)` line, read from its default reporter. */
export function countsOfRun(run: Captured): Counts {
  const line = TESTS_LINE.exec(run.stdout)?.[1] ?? "";

  function number(pattern: RegExp) {
    return Number(pattern.exec(line)?.[1] ?? 0);
  }

  return { failed: number(FAILED_COUNT), passed: number(PASSED_COUNT), total: number(TOTAL_COUNT) };
}

/** The counts of every run in `runs`, summed. */
export function summedCounts(runs: readonly Captured[]): Counts {
  const sum: Counts = { failed: 0, passed: 0, total: 0 };

  for (const run of runs) {
    const counts = countsOfRun(run);
    sum.failed += counts.failed;
    sum.passed += counts.passed;
    sum.total += counts.total;
  }

  return sum;
}
