import { CREATED_RE, SERIAL_LINE_RE, SOURCE_MAX } from "./persist-doc.constants.ts";
/** The ordered check tables handoff and journal validation run: head checks on the frontmatter, then section checks. */
import { parseFrontmatter, slugFromFilename, type FrontmatterMap, type Sections } from "./persist-doc.ts";
import { sectionBodies, unclosedFenceErrors } from "./persist-sections.ts";

/** A saved doc under validation. */
export type Doc = {
  filename: string;
  text: string;
  map: FrontmatterMap;
  body: string;
};

export type HeadCheck = (doc: Doc) => string[];
export type SectionCheck = (doc: Doc, sections: Sections) => string[];

/** `[error]` when `bad`, else none. */
export const when = (bad: boolean, error: string): string[] => (bad ? [error] : []);

export const serialLineCheck: HeadCheck = ({ text }) => {
  const line = text.split("\n").find((l) => l.startsWith("serial:"));
  return when(!line || !SERIAL_LINE_RE.test(line), "serial line");
};

/** One `missing <key>` per key the doc's frontmatter lacks or leaves empty. */
export const missingErrors = ({ map }: Doc, keys: readonly string[]): string[] =>
  keys.filter((k) => map[k] == null || map[k] === "").map((k) => `missing ${k}`);

/** The key's name as the error when `key` is set and does not match `pattern`. */
export function patternErrors({ map }: Doc, key: string, pattern: RegExp): string[] {
  const value = map[key];
  return when(!!value && !pattern.test(value), key);
}

export const createdCheck: HeadCheck = (doc) => patternErrors(doc, "created", CREATED_RE);

export const sourceLengthCheck: HeadCheck = ({ map }) =>
  when(typeof map.source === "string" && map.source.length > SOURCE_MAX, "source length");

export const slugCheck: HeadCheck = ({ filename, map }) =>
  when(!!map.name && slugFromFilename(filename) !== map.name, "name/filename slug");

export const h1Check: HeadCheck = ({ body, map }) => when(!body.trim().startsWith(`# ${map.name}`), "h1 slug");

/** `heading order` unless the first H2s are `required`, then `extra h2` for any other. */
export function headingErrors({ order }: Sections, required: readonly string[]): string[] {
  const first = order.slice(0, required.length);
  return [
    ...when(
      required.some((h, i) => first[i] !== h),
      "heading order",
    ),
    ...when(
      order.some((h) => !required.includes(h)),
      "extra h2",
    ),
  ];
}

/**
 * Run `head` checks, stop at unclosed code fences, then run `sections` checks; errors keep table order, once each.
 * A filename the pattern rejects reports `filename` first.
 */
export function validateDoc(
  { filename, text }: { filename: string; text: string },
  { filenameRe, head, sections }: { filenameRe: RegExp; head: HeadCheck[]; sections: SectionCheck[] },
): string[] {
  const errors: string[] = when(!filenameRe.test(filename), "filename");
  const fm = parseFrontmatter(text);
  if (fm.error !== undefined) return [...errors, fm.error];
  const doc: Doc = { body: fm.body, filename, map: fm.map, text };
  errors.push(...head.flatMap((check) => check(doc)));
  const fence = unclosedFenceErrors(text);
  if (fence.length) return [...new Set([...errors, ...fence])];
  const parsed = sectionBodies(fm.body);
  errors.push(...sections.flatMap((check) => check(doc, parsed)));
  return [...new Set(errors)];
}
