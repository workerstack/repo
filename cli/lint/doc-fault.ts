import { FAULTS, INTERNAL, INTERNAL_FAULT, STOPWORDS } from "./public-jsdoc.constants.ts";

const LEADING_STAR = /^\*/;
const LINE_STAR = /^\s*\*?\s?/;
const WORDS = /[\p{L}\p{N}]+/gu;
const CAMEL_JOIN = /([\p{Ll}\p{N}])(\p{Lu})/gu;
const TAG_LINE = /^\s*@/m;

/** A JSDoc block's `value` as plain text: the leading `*` of the block and of each line removed. */
function docText(value: string): string {
  return value
    .replace(LEADING_STAR, "")
    .split("\n")
    .map((line) => line.replace(LINE_STAR, ""))
    .join("\n");
}

function words(text: string): string[] {
  return [...text.toLowerCase().matchAll(WORDS)].map((match) => match[0]);
}

function nameWords(name: string): string[] {
  return words(name.replaceAll(CAMEL_JOIN, "$1 $2"));
}

/**
 * What is wrong with the JSDoc `value` (undefined for no JSDoc) of `name`, finishing "… and ", or null when it is
 * fine: missing, empty, citing an internal reference, or saying nothing beyond the name.
 */
export function docFault(value: string | undefined, name: string): string | null {
  if (value === undefined) return FAULTS.missing;
  const text = docText(value);
  const prose = text.split(TAG_LINE, 1).join("").trim();

  if (prose === "") return FAULTS.empty;
  const internal = INTERNAL.exec(text);

  if (internal !== null) return INTERNAL_FAULT(internal[0]);
  const own = [...nameWords(name), ...words(name)];

  return words(prose).every((word) => own.includes(word) || STOPWORDS.includes(word)) ? FAULTS.restates : null;
}
