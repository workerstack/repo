/** `validateFastDoc`: the checks a fast plan and a fast roadmap share, with what each kind sets. */
import {
  type Doc,
  type HeadCheck,
  createdCheck,
  h1Check,
  missingErrors,
  patternErrors,
  serialLineCheck,
  serialNameCheck,
  slugCheck,
  sourceLengthCheck,
  when,
} from "./persist-doc-checks.ts";
import { LAST, MISTAKES_H2 } from "./persist-doc.constants.ts";
import { type Sections, parseFrontmatter, stripFrontmatter } from "./persist-doc.ts";
import { FAST_TICKED_RE } from "./persist-fast-plan.constants.ts";
import { extractStrategy } from "./persist-keys.ts";
import { mistakeLogErrors } from "./persist-mistakes.ts";
import { FILENAME_RE } from "./persist-plan.constants.ts";
import { sectionBodies, unclosedFenceErrors } from "./persist-sections.ts";

/** What one kind of fast doc is checked against. */
export type FastRules = {
  requiredKeys: readonly string[];
  status: RegExp;
  /** The head checks the kind adds to the common ones. */
  extraHead: HeadCheck[];
  /** The kind's headings in order; an optional `## Previous mistakes` may follow them. */
  headings: readonly string[];
  /** Entry kinds the optional Previous mistakes log accepts. */
  sources: readonly string[];
  lineCap: number;
  lineCount: (text: string) => number;
  noStrategy: string;
  onlySections: string;
  tooLong: string;
  onlyOpenBoxes: string;
  /** Denials of the sections' content. */
  content: (sections: Sections) => string[];
};

/** The head denials: serial line, required keys, status, created, source, name and heading. */
function headErrors(doc: Doc, rules: FastRules): string[] {
  const checks: HeadCheck[] = [
    serialLineCheck,
    (d) => missingErrors(d, rules.requiredKeys),
    (d) => patternErrors(d, "status", rules.status),
    createdCheck,
    sourceLengthCheck,
    ...rules.extraHead,
    slugCheck,
    h1Check,
    serialNameCheck,
  ];

  return checks.flatMap((check) => check(doc));
}

type Body = { text: string; body: string; fresh: boolean; previous: string | undefined };

/** The heading order is the kind's headings, optionally followed by Previous mistakes. */
function headingsOk(order: string[], headings: readonly string[]): boolean {
  const kind = order.at(LAST) === MISTAKES_H2 ? order.slice(0, LAST) : order;

  return kind.join() === headings.join();
}

/** The denials of the body: sections, size, content, the optional mistakes log and boxes. */
function bodyErrors(doc: Body, rules: FastRules): string[] {
  const { text, body, fresh, previous } = doc;
  const sections = sectionBodies(body);
  const saved = previous === undefined ? null : sectionBodies(stripFrontmatter(previous));
  const log = { fresh: false, kind: "fast doc", previous: saved, sources: rules.sources };

  return [
    ...when({ bad: !headingsOk(sections.order, rules.headings), error: rules.onlySections }),
    ...when({ bad: rules.lineCount(text) > rules.lineCap, error: rules.tooLong }),
    ...rules.content(sections),
    ...mistakeLogErrors(sections.order, sections.bodies, log),
    ...when({ bad: fresh && FAST_TICKED_RE.test(body), error: rules.onlyOpenBoxes }),
  ];
}

/**
 * Every denial for a saved fast doc, in order, once each. `fresh` is a new doc: only `[ ]` boxes. `previous` is
 * the saved text an update replaces; its Previous mistakes entries must be kept.
 */
export function validateFastDoc(
  {
    filename,
    text,
    fresh,
    previous,
  }: { filename: string; text: string; fresh: boolean; previous?: string | undefined },
  rules: FastRules,
): string[] {
  const errors: string[] = when({ bad: !FILENAME_RE.test(filename), error: "filename" });
  const fm = parseFrontmatter(text);

  if (fm.error !== undefined) return [...errors, fm.error];
  const head = headErrors({ body: fm.body, filename, map: fm.map, text }, rules);
  const strategy = when({ bad: extractStrategy(text) !== undefined, error: rules.noStrategy });
  const fence = unclosedFenceErrors(text);
  const rest = fence.length > 0 ? fence : bodyErrors({ body: fm.body, fresh, previous, text }, rules);

  return [...new Set([...errors, ...head, ...strategy, ...rest])];
}
