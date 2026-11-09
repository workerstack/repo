/**
 * The checks `repo check`, `repo turn` and `repo lint --baseline` run beside oxlint as scripts on the TypeScript
 * compiler API, by the names `lint.skip` takes. Kept apart from the checks so the oxlint config can accept the names
 * without loading typescript.
 */
export const MAGIC_NUMBER = "repo/magic-number";
export const MAGIC_STRING = "repo/magic-string";
export const GUARD_REJECTS = "repo/guard-rejects";
export const SCRIPT_RULES: readonly string[] = [MAGIC_NUMBER, MAGIC_STRING, GUARD_REJECTS];
