/** The errno code `process.kill(pid, 0)` throws when the pid exists but belongs to another user. */
export const PERMISSION_DENIED = "EPERM";
/** The name every run root starts with; `repo-test-<pid>-<suffix>` gives the pid of the run that made it. */
export const ROOT_PREFIX = "repo-test-";
