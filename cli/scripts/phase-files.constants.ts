/** How to call `repo phase-files`. */
export const PHASE_FILES_USAGE = "usage: repo phase-files <plan serial|path> <phases, e.g. 2,3>";

/** The `repo --help` row. */
export const PHASE_SUMMARY = "Map a parallel group's unstaged changes to its phases";
export const USAGE: string = `${PHASE_FILES_USAGE}\n`;

/** The exit code of a refused call: a bad argument, a missing plan or phase, or a failed git. */
export const REFUSED_EXIT: number = 2;

/** A porcelain entry is two status letters, a space and a path of at least one character. */
export const MIN_ENTRY_LENGTH: number = 4;

/** Where a porcelain entry's path starts. */
export const PATH_START: number = 3;

/** The status letters of a rename and a copy, whose entry carries the old path in the next field. */
export const MOVE_STATUSES: readonly string[] = ["R", "C"];

/** `Array.prototype.at`'s index of the last item. */
export const LAST: number = -1;

/** A plan argument of digits alone is a serial, not a path. */
export const SERIAL_ARG: RegExp = /^\d+$/;

/** A plan file's name starts with its serial and a dash; group 1 is the serial. */
export const PLAN_SERIAL: RegExp = /^(\d+)-/;

/** The arguments of a request: a plan and its phases. */
export const REQUEST_ARGS: number = 2;
