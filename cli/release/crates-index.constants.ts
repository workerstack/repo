/** Where the crates.io sparse index lives, and how repo introduces itself to it. */

/** The base of every sparse index URL. */
export const INDEX_BASE: string = "https://index.crates.io/";
/** The header value crates.io asks every client to send; generic, naming no person. */
export const USER_AGENT: string = "@workerstack/repo";
/** The HTTP status of a crate the index has. */
export const STATUS_OK: number = 200;
/** The HTTP status of a crate the index does not have. */
export const STATUS_ABSENT: number = 404;
/** Crate names of this length or less live in a directory named for their length. */
export const SHORT_NAME_MAX: number = 3;
/** The length of each of the two directory names above a longer crate name. */
export const DIR_LENGTH: number = 2;
/** Where the second directory name of a longer crate name ends. */
export const SECOND_DIR_END: number = 4;
