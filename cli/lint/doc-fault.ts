import { FAULTS, INTERNAL, INTERNAL_FAULT, STOPWORDS } from "./public-jsdoc.constants.ts";

/** A JSDoc block's `value` as plain text: the leading `*` of the block and of each line removed. */
function docText(value: string): string {
  return value
    .replace(/^\*/, "")
    .split("\n")
    .map((line) => line.replace(/^\s*\*?\s?/, ""))
    .join("\n");
}

const words = (text: string): string[] => text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
const nameWords = (name: string): string[] => words(name.replace(/([\p{Ll}\p{N}])(\p{Lu})/gu, "$1 $2"));

/**
 * What is wrong with the JSDoc `value` (undefined for no JSDoc) of `name`, finishing "… and ", or null when it is
 * fine: missing, empty, citing an internal reference, or saying nothing beyond the name.
 */
export function docFault(value: string | undefined, name: string): string | null {
  if (value === undefined) return FAULTS.missing;
  const text = docText(value);
  const prose = text.split(/^\s*@/m, 1).join("").trim();
  if (prose === "") return FAULTS.empty;
  const internal = INTERNAL.exec(text);
  if (internal !== null) return INTERNAL_FAULT(internal[0]);
  const own = [...nameWords(name), ...words(name)];
  return words(prose).every((word) => own.includes(word) || STOPWORDS.includes(word)) ? FAULTS.restates : null;
}
