/** One board line: its fields flattened to words, and a work label with pasted blocks and secrets taken out. */
import {
  DIGIT_RE,
  LOWER_RE,
  NONE,
  OPAQUE_MIN,
  OPAQUE_PUNCT_RE,
  REDACTED,
  SECRET_AFTER_KEY,
  SECRET_PREFIX_RE,
  SPACE_SPLIT_RE,
  SPACES_RE,
  STRIP_BLOCKS,
  UNSAFE_NAME_RE,
  UPPER_RE,
  WORK_CAP,
} from "./board.constants.ts";
import type { LooseRow } from "./board.types.ts";

const NOTHING: readonly unknown[] = [undefined, null];

/** Whether `value` is truthy, for values of any type. */
export function isTruthy(value: unknown): boolean {
  return Boolean(value);
}

/** `value` as text; null and undefined read as "". */
export function str(value: unknown): string {
  return NOTHING.includes(value) ? "" : String(value);
}

/** `s`, or a dash when it is empty. */
export function orNone(s: string): string {
  return s === "" ? NONE : s;
}

/** One word: whitespace runs become dashes. */
export function field(value: unknown): string {
  return orNone(str(value).replaceAll(SPACES_RE, "-").trim());
}

/** One line: whitespace runs become one space. */
export function oneLine(value: unknown): string {
  return orNone(str(value).replaceAll(SPACES_RE, " ").trim());
}

/** A file-name-safe form of a field. */
export function safe(value: unknown): string {
  return field(value).replaceAll(UNSAFE_NAME_RE, "_");
}

function isOpaqueToken(token: string): boolean {
  return (
    token.length >= OPAQUE_MIN &&
    !OPAQUE_PUNCT_RE.test(token) &&
    UPPER_RE.test(token) &&
    LOWER_RE.test(token) &&
    DIGIT_RE.test(token)
  );
}

/**
 * The user's own words from a prompt or label: pasted blocks stripped, secrets redacted, capped.
 * "" when nothing is left.
 */
export function workLabel(text: unknown): string {
  let s = str(text);
  for (const re of STRIP_BLOCKS) s = s.replace(re, " ");
  for (const re of SECRET_AFTER_KEY)
    s = s.replace(re, (_: string, key: string, sep: string) => `${key}${sep}${REDACTED}`);
  s = s.replaceAll(SECRET_PREFIX_RE, REDACTED);
  s = s
    .split(SPACE_SPLIT_RE)
    .map((token) => (isOpaqueToken(token) ? REDACTED : token))
    .join(" ");
  return s.replaceAll(SPACES_RE, " ").trim().slice(0, WORK_CAP).trim();
}

export function formatLine(row: LooseRow): string {
  return [
    field(row.time),
    field(row.provider),
    field(row.model),
    field(row.effort),
    field(row.session),
    oneLine(row.cwd),
    orNone(workLabel(row.work)),
  ].join(" ");
}

/** `value` as text, or a dash when it is missing or blank. */
export function valueOrNone(value: unknown): string {
  const text = str(value);
  return text.trim() === "" ? NONE : text;
}
