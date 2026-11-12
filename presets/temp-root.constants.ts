/** The errno code `process.kill(pid, 0)` throws when the pid exists but belongs to another user. */
export const PERMISSION_DENIED = "EPERM";

/** The name every run root starts with; `repo-test-<pid>-<suffix>` gives the pid of the run that made it. */
export const ROOT_PREFIX = "repo-test-";

/**
 * The dir bun itself writes into TEMP when a child runs `node` through its shim (`bun-node-<hash>`); no test makes
 * it.
 */
export const BUN_SHIM_PREFIX = "bun-node-";
