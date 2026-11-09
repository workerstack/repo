import { DEFAULT_COMMIT, type ResolvedConfig } from "../config.ts";
import { DEFAULT_COVERAGE } from "../coverage-config.ts";

/** The resolved-config keys a test rarely varies: the default commit limit, no lint.skip, no knip.ignore and the default coverage paths. */
export const BASE_CONFIG: Pick<ResolvedConfig, "commit" | "lint" | "knip" | "coverage" | "tdd"> = {
  commit: DEFAULT_COMMIT,
  lint: { skip: [] },
  knip: { ignore: [] },
  coverage: DEFAULT_COVERAGE,
  tdd: false,
};
