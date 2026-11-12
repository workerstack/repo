import type { Json } from "./json.ts";
import {
  KEYWORD_ENTRY_FIX,
  KEYWORD_PATTERN,
  KEYWORD_PATTERN_FIX,
  KEYWORDS_FILE,
  KEYWORDS_FIELD,
  KEYWORDS_FIX,
  KEYWORDS_MAX,
  ONE,
} from "./keywords.constants.ts";

/** Whether every entry of a list is a string. */
export function isStringList(entries: readonly unknown[]): entries is string[] {
  return entries.every((entry) => typeof entry === "string");
}

function line(text: string): string {
  return `${KEYWORDS_FILE}: ${text}`;
}

/** One line per entry that is not a string or not shaped like a GitHub topic; positions are 1-based. */
function entryLines(entries: readonly unknown[]): string[] {
  const lines: string[] = [];

  for (const [index, entry] of entries.entries()) {
    if (typeof entry !== "string")
      lines.push(line(`keyword ${index + ONE} is ${JSON.stringify(entry)}, not a string; ${KEYWORD_ENTRY_FIX}`));
    else if (!KEYWORD_PATTERN.test(entry))
      lines.push(line(`keyword "${entry}" is not a GitHub topic; ${KEYWORD_PATTERN_FIX}`));
  }

  return lines;
}

/** One line per string listed more than once, and, when every entry is a string, one if they are out of order. */
function orderLines(entries: readonly unknown[]): string[] {
  const names = entries.filter((entry): entry is string => typeof entry === "string");
  const counts = new Map<string, number>();

  for (const name of names) counts.set(name, (counts.get(name) ?? 0) + ONE);

  const lines = [...counts]
    .filter(([, count]) => count > ONE)
    .map(([name, count]) => line(`keyword "${name}" is listed ${count} times; keep one`));

  const unique = [...counts.keys()];

  if (isStringList(entries) && unique.join() !== unique.toSorted().join())
    lines.push(line(`"${KEYWORDS_FIELD}" are not sorted; write ${JSON.stringify(unique.toSorted())}`));

  return lines;
}

/**
 * The problems of a package's `keywords` as written, one line each with the fix, empty when it holds 1 to 20 unique
 * GitHub topics in code-unit order.
 */
export function keywordLines(value: Json | undefined): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    const state = value === undefined ? "is missing" : `is ${JSON.stringify(value)}`;

    return [line(`"${KEYWORDS_FIELD}" ${state}; ${KEYWORDS_FIX}`)];
  }

  const count: string[] =
    value.length > KEYWORDS_MAX
      ? [line(`"${KEYWORDS_FIELD}" has ${value.length} entries; keep at most ${KEYWORDS_MAX}, GitHub's topic limit`)]
      : [];

  return [...count, ...entryLines(value), ...orderLines(value)];
}
