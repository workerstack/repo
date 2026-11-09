import { DEFAULT_COMMIT, type ResolvedConfig } from "../config.ts";
import { DEFAULT_COVERAGE } from "../coverage-config.ts";

/** The resolved-config keys a test rarely varies: the default commit limit, no lint.skip and the default coverage paths. */
export const BASE_CONFIG: Pick<ResolvedConfig, "commit" | "lint" | "coverage"> = {
  commit: DEFAULT_COMMIT,
  lint: { skip: [] },
  coverage: DEFAULT_COVERAGE,
};
