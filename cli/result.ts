/**
 * A step that either produced its value or refused with an error: the lines to print, a refusal line, or an exit
 * code. Callers branch on `ok`, never on the value's representation.
 */
export type Result<T, E = string[]> = { ok: true; value: T } | { ok: false; error: E };
