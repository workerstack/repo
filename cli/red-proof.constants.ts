/** The names `repo red-proof` reads from git and vitest. */

/** The `git diff --name-status` letter of a path the change adds. */
export const STATUS_ADDED = "A";

/** The `git diff --name-status` letter of a path the change deletes. */
export const STATUS_DELETED = "D";

/** The status vitest's json report gives a test file with a failing test. */
export const REPORT_FAILED = "failed";

/** The bytes in a kibibyte. */
const KIB = 1024;

/** The most output a vitest run may print before it is cut off: 64 MiB. */
export const MAX_BUFFER: number = 64 * KIB * KIB;

/** How many trailing stderr lines a missing-report problem quotes. */
export const STDERR_TAIL_LINES = -3;
