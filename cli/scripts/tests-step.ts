/** The related-tests step of `repo turn`: `vitest related --run` in each owning package of the changed code. */
import path from "node:path";

import type { Captured } from "./lint.ts";
import {
  countsOfRun,
  dirName,
  failed,
  LINTABLE,
  owners,
  passed,
  type Counts,
  type StepResult,
  type Turn,
} from "./turn-steps.ts";

function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/** The step's label from the summed counts, the packages without vitest and the runs that exited non-zero. */
function testsLabel(counts: Counts, skipped: readonly string[], bad: readonly Captured[]): string {
  const none = skipped.length > 0 ? ` (no vitest in ${skipped.join(", ")})` : "";
  if (counts.failed > 0) return `${plural(counts.total, "related test")}, ${counts.failed} failed${none}`;
  if (bad.length > 0) return `related tests failed${none}`;
  if (counts.passed > 0) return `${plural(counts.passed, "related test")} passed${none}`;
  return none === "" || counts.total > 0 ? `0 related tests${none}` : `related tests skipped${none}`;
}

/** One `vitest related --run` per owning package on its changed code files; null where vitest is not installed. */
function relatedRuns(turn: Turn): { owner: string; run: Captured | null }[] {
  return owners(turn).flatMap((owner) => {
    const own = turn.changes
      .filter((change) => !change.deleted && change.owner === owner && LINTABLE.test(change.rel))
      .map((change) => path.posix.relative(owner, change.rel));
    if (own.length === 0) return [];
    const args = ["related", "--run", "--passWithNoTests", ...own];
    return [{ owner, run: turn.bins.vitest(args, path.join(turn.root, owner)) }];
  });
}

/** The related tests of the change set, their counts summed over the packages. */
export function testsStep(turn: Turn): StepResult {
  const runs = relatedRuns(turn);
  const skipped = runs.filter(({ run }) => run === null).map(({ owner }) => dirName(owner));
  const ran = runs.flatMap(({ run }) => (run === null ? [] : [run]));
  const counts: Counts = { failed: 0, passed: 0, total: 0 };
  for (const next of ran.map(countsOfRun)) {
    counts.failed += next.failed;
    counts.passed += next.passed;
    counts.total += next.total;
  }
  const bad = ran.filter((run) => run.code !== 0);
  const label = testsLabel(counts, skipped, bad);
  return bad.length === 0
    ? passed(label)
    : failed(
        label,
        bad.map((run) => `${run.stdout}${run.stderr}`),
      );
}
