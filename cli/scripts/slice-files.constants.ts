/** How to call `repo slice-files`. */
export const SLICE_USAGE = "usage: repo slice-files <roadmap path> <slice>";

/** The `repo --help` row. */
export const SLICE_SUMMARY = "Check the branch's changes against a parallel roadmap slice's path list";
export const USAGE: string = `${SLICE_USAGE}\n`;

/** The exit code of a refused call: a bad argument, a missing roadmap or slice, or a failed git. */
export const REFUSED_EXIT: number = 2;

/** The arguments of a request: a roadmap path and one slice number. */
export const REQUEST_ARGS: number = 2;

/** A roadmap file's name starts with its serial and a dash; group 1 is the serial. */
export const ROADMAP_SERIAL: RegExp = /^(\d+)-/;
