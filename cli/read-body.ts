/** The body rules of a commit message: which lines pass, which are refused, and which are free text. */
import {
  ATTRIBUTION,
  BREAKING_KEY,
  CO_AUTHOR,
  KEY_VALUE,
  LAST,
  LIST_THE_CO_AUTHOR,
  REVERT_LINE,
} from "./commit-msg.constants.ts";
import { BREAKING_FOOTER } from "./conventional.ts";

/** What the body holds: the refusals of its trailer and attribution lines, and its free lines, the why candidates. */
type Body = { problems: string[]; free: string[] };

/** Where a body line stands: the co-authors the repo lists, and whether its paragraph is the trailer block. */
type Place = { coAuthors: readonly string[]; isTrailerBlock: boolean };

/**
 * The refusal of one body line, or null when it is no trailer, `Breaking:` line or attribution, or is a listed
 * co-author in the trailer block.
 */
function lineProblem(line: string, { coAuthors, isTrailerBlock }: Place): string | null {
  if (ATTRIBUTION.test(line)) return `remove the attribution "${line}"; the work is the author's`;

  const identity = CO_AUTHOR.exec(line)?.groups?.["identity"];

  if (identity !== undefined && !coAuthors.includes(identity))
    return `the co-author "${identity}" is not listed; ${LIST_THE_CO_AUTHOR}`;

  if (identity !== undefined)
    return isTrailerBlock ? null : `move "${line}" to the last paragraph, which holds only co-author lines`;

  if (BREAKING_KEY.test(line)) return `write "${line}" as a "BREAKING CHANGE: <what breaks>" footer`;

  if (KEY_VALUE.test(line))
    return `remove "${line}"; commits carry no Key: value lines (write a why as a plain sentence)`;

  return null;
}

/** The body's paragraphs: its trimmed non-blank lines, split at blank lines. */
function paragraphsOf(body: readonly string[]): string[][] {
  const paragraphs: string[][] = [[]];

  for (const raw of body) {
    const line = raw.trim();

    if (line === "") paragraphs.push([]);
    else paragraphs.at(LAST)?.push(line);
  }

  return paragraphs.filter((paragraph) => paragraph.length > 0);
}

/**
 * Sorts one paragraph's lines into `into`: a footer line and the lines under it, a revert line and a placed co-author
 * pass.
 */
function readParagraph(paragraph: readonly string[], place: Place, into: Body): void {
  let isInFooter = false;

  for (const line of paragraph) {
    isInFooter ||= BREAKING_FOOTER.test(line);
    const problem = lineProblem(line, place);

    if (problem !== null) into.problems.push(problem);
    else if (!isInFooter && !REVERT_LINE.test(line) && !CO_AUTHOR.test(line)) into.free.push(line);
  }
}

/**
 * Sorts the body's lines: a BREAKING CHANGE footer with the lines under it in its paragraph, git's revert line, and
 * listed co-authors in a last paragraph of only co-author lines pass; a trailer, `Breaking:` line or attribution is
 * refused wherever it stands; every other line is free text.
 */
export function readBody(body: readonly string[], coAuthors: readonly string[] = []): Body {
  const read: Body = { free: [], problems: [] };
  const paragraphs = paragraphsOf(body);
  const last = paragraphs.at(LAST);
  const trailers = last?.every((line) => CO_AUTHOR.test(line)) === true ? last : undefined;

  for (const paragraph of paragraphs)
    readParagraph(paragraph, { coAuthors, isTrailerBlock: paragraph === trailers }, read);

  return read;
}
