/** The run copies' names before the jsonc rename, as 0.1.0 and 0.2.0-rc.0 wrote them; a killed check left them. */
export const JSON_RUN_COPY_GLOBS: readonly string[] = [".oxlintrc.unskipped-*.json", "knip.unignored-*.json"];

/** Where a glob's pid goes. */
export const PID_HOLE = "*";

/** A pid as a name carries it. */
export const PID_RE: RegExp = /^\d+$/;

/** The code `kill(pid, 0)` throws when no process holds `pid`. */
export const NO_PROCESS = "ESRCH";
