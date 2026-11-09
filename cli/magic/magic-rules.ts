/**
 * The magic literal checks `cli/check-magic.ts` runs beside oxlint, by the names `lint.skip` takes. Kept apart from
 * the checks so the oxlint config can accept the names without loading typescript.
 */
export const MAGIC_NUMBER = "repo/magic-number";
export const MAGIC_STRING = "repo/magic-string";
export const MAGIC_RULES: readonly string[] = [MAGIC_NUMBER, MAGIC_STRING];

/** One magic literal: the file, offset and one-based line and column it is reported at, its rule and the fix. */
export type MagicHit = { fileName: string; at: number; line: number; column: number; rule: string; message: string };
