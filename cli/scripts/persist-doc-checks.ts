/**
 * The ordered check tables handoff and journal validation run: head checks on the frontmatter, then section
 * checks.
 */
import { CREATED_RE, SERIAL_LINE_RE, SERIAL_PREFIX_RE, SOURCE_MAX } from "./persist-doc.constants.ts";
import { hasKey, parseFrontmatter, slugFromFilename, type FrontmatterMap, type Sections } from "./persist-doc.ts";
import { COMMIT_SUBJECT_RE } from "./persist-plan.constants.ts";
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
export function when({ bad, error }: { bad: boolean; error: string }): string[] {
  return bad ? [error] : [];
}

export function serialLineCheck({ text }: Doc): string[] {
  const line = text.split("\n").find((l) => l.startsWith("serial:"));

  return when({ bad: line === undefined || !SERIAL_LINE_RE.test(line), error: "serial line" });
}

/** One `missing <key>` per key the doc's frontmatter lacks or leaves empty. */
export function missingErrors({ map }: Doc, keys: readonly string[]): string[] {
  return keys.filter((k) => map[k] == null || map[k] === "").map((k) => `missing ${k}`);
}

/** The key's name as the error when `key` is set and does not match `pattern`. */
export function patternErrors({ map }: Doc, key: string, pattern: RegExp): string[] {
  const value = map[key];

  return when({ bad: value !== undefined && value !== "" && !pattern.test(value), error: key });
}

export function createdCheck(doc: Doc): string[] {
  return patternErrors(doc, "created", CREATED_RE);
}

export function sourceLengthCheck({ map }: Doc): string[] {
  return when({ bad: map.source !== undefined && map.source.length > SOURCE_MAX, error: "source length" });
}

/** `commit` when the frontmatter carries a `commit:` that is not a Conventional Commits subject. */
export function commitCheck({ map }: Doc): string[] {
  return when({ bad: hasKey(map, "commit") && !COMMIT_SUBJECT_RE.test(String(map.commit)), error: "commit" });
}

/** `serial/filename` when the frontmatter serial and the file name's serial prefix differ. */
export function serialNameCheck({ filename, map }: Doc): string[] {
  const fileSerial = SERIAL_PREFIX_RE.exec(filename)?.[1];
  const named = fileSerial !== undefined && map.serial !== undefined && map.serial !== "";

  return when({ bad: named && Number(map.serial) !== Number(fileSerial), error: "serial/filename" });
}

export function slugCheck({ filename, map }: Doc): string[] {
  const named = map.name !== undefined && map.name !== "";

  return when({ bad: named && slugFromFilename(filename) !== map.name, error: "name/filename slug" });
}

export function h1Check({ body, map }: Doc): string[] {
  return when({ bad: !body.trim().startsWith(`# ${String(map.name)}`), error: "h1 slug" });
}

/** What a doc's prose sections must hold: bullet sections, what a bullet looks like, and the Goal's sentences. */
export type ProseRules = { headings: readonly string[]; bullets: RegExp; split: RegExp; max: number };

/** `goal` unless the Goal holds one to `max` sentences, as `split` cuts them. */
function goalErrors(goal: string | undefined, { split, max }: ProseRules): string[] {
  const text = (goal ?? "").trim();
  const sentences = text.split(split).filter((s) => s.trim() !== "");

  return when({ bad: text === "" || sentences.length < 1 || sentences.length > max, error: "goal" });
}

/** The Goal's error, then `<h> empty` or `<h> bullets` for each bullet section that is empty or not bullets. */
function proseErrors(bodies: Record<string, string>, rules: ProseRules): string[] {
  const bullets = rules.headings.flatMap((h) => {
    const b = (bodies[h] ?? "").trim();

    return b === "" ? [`${h} empty`] : when({ bad: !rules.bullets.test(b), error: `${h} bullets` });
  });

  return [...goalErrors(bodies.Goal, rules), ...bullets];
}

/** A section check holding a doc's prose to `rules`. */
export function proseCheck(rules: ProseRules): SectionCheck {
  return (_doc, { bodies }) => proseErrors(bodies, rules);
}

/** `heading order` unless the first H2s are `required`, then `extra h2` for any other. */
export function headingErrors({ order }: Pick<Sections, "order">, required: readonly string[]): string[] {
  const first = order.slice(0, required.length);

  return [
    ...when({ bad: required.some((h, i) => first[i] !== h), error: "heading order" }),
    ...when({ bad: order.some((h) => !required.includes(h)), error: "extra h2" }),
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
  const errors: string[] = when({ bad: !filenameRe.test(filename), error: "filename" });
  const fm = parseFrontmatter(text);

  if (fm.error !== undefined) return [...errors, fm.error];
  const doc: Doc = { body: fm.body, filename, map: fm.map, text };
  errors.push(...head.flatMap((check) => check(doc)));
  const fence = unclosedFenceErrors(text);

  if (fence.length > 0) return [...new Set([...errors, ...fence])];
  const parsed = sectionBodies(fm.body);
  errors.push(...sections.flatMap((check) => check(doc, parsed)));

  return [...new Set(errors)];
}
