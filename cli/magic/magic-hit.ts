/** One magic literal: the file, offset and one-based line and column it is reported at, its rule and the fix. */
export type MagicHit = { fileName: string; at: number; line: number; column: number; rule: string; message: string };
