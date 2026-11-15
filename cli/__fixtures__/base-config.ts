import { DEFAULT_COMMIT, type LintSkip, type ResolvedConfig, type ResolvedLint } from "../config.ts";
import { DEFAULT_NIGHTLY } from "../nightly-config.ts";
import { DEFAULT_COVERAGE } from "../coverage-config.ts";

/** The resolved-config keys a test rarely varies: the default commit limit, no lint.skip, no knip.ignore, the default coverage paths and no link paths. */
export const BASE_CONFIG: Pick<ResolvedConfig, "commit" | "lint" | "knip" | "coverage" | "nightly" | "tdd" | "ci" | "workflow" | "link"> = {
  commit: DEFAULT_COMMIT,
  lint: { plugins: {}, rules: [], skip: [] },
  knip: { ignore: [] },
  coverage: DEFAULT_COVERAGE,
  nightly: DEFAULT_NIGHTLY,
  tdd: false,
  ci: { checks: {} },
  workflow: "worktree",
  link: { paths: {}, push: "block" },
};

/** A resolved `lint` of `skip`, with no consumer plugins or rules, and the `more` keys a test sets. */
export function lintWith(skip: readonly LintSkip[], more: Partial<ResolvedLint> = {}): ResolvedLint {
  return { plugins: {}, rules: [], skip, ...more };
}
