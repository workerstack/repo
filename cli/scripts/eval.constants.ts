import type { Via } from "../eval/estimate.ts";
import { REPO, STATE } from "../repo-dirs.ts";

/** What `repo eval` prints and exits with. */
export const EVAL_SUMMARY = "Score a model on evals/<name> cases; prints a cost estimate and refuses over a cap";

/** What `repo eval` takes. */
export const EVAL_ARGS = "<name> [--dry-run] [--max-cost <usd>] [--changed <base>] [--via session|api]";
export const EVAL_USAGE: string = `usage: bun repo eval ${EVAL_ARGS}`;
export const DRY_RUN_FLAG = "--dry-run";
export const MAX_COST_FLAG = "--max-cost";
export const CHANGED_FLAG = "--changed";
export const VIA_FLAG = "--via";
export const VIA_LINE: string = `eval: ${VIA_FLAG} takes session or api`;

/**
 * The cap in USD per via when `--max-cost` is not given: a session run spends plan usage, not dollars, and its bound
 * cannot be sound, so it gets room; an API run spends dollars against a sound bound, so it keeps $1.00.
 */
export const DEFAULT_CAPS: Readonly<Record<Via, number>> = { api: 1, session: 5 };
export const EXIT_OK = 0;
export const EXIT_FAILED = 1;
export const EXIT_USAGE = 4;

/** The main checkout's folder for eval state, and its cache and run-summary subfolders. */
export const EVALS_DIR: string = `${REPO}/${STATE}/evals`;
export const CACHE_DIR = "cache";
export const RUNS_DIR = "runs";
