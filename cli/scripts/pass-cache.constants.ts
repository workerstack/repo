import { DAY } from "./clean.constants.ts";

/** The `.repo/tmp` entry that holds one empty file per step pass, named by its key. */
export const PASS_DIR = "turn";

/** A pass entry older than this is removed the next time a gate records. */
export const PASS_AGE: number = 7 * DAY;

/** The prefix of the temp dir that holds the index copy a state tree is written from. */
export const INDEX_TEMP_PREFIX = "repo-turn-index-";

/** The HEAD part of a key before the first commit. */
export const NO_HEAD = "none";
