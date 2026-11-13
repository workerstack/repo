import { parse, printParseErrorCode, type ParseError } from "jsonc-parser";
import { z } from "zod";

import type { RegionResult } from "./region.ts";

/** What an edit makes: the new text, or the repair that explains why the file is left as is. */
export type Edited = { text: string } | { repair: string };

/** Formatting for an inserted key or item: two spaces, and the line ending the file already uses. */
export type Formatting = { eol: string; insertSpaces: true; tabSize: number };

const INDENT = 2;

/** Why `text` is left as is, naming the line of its first JSONC error; null when it holds an object. */
function unusable(text: string): string | null {
  const problems: ParseError[] = [];
  const value: unknown = parse(text, problems, { allowTrailingComma: true });
  const [problem] = problems;

  if (problem !== undefined) {
    const line = text.slice(0, problem.offset).split("\n").length;

    return `not valid JSONC at line ${line} (${printParseErrorCode(problem.error)}); left as is`;
  }

  const object = z.record(z.string(), z.unknown()).safeParse(value).success;

  return object ? null : "must hold a JSON object; left as is";
}

/**
 * Runs `edit` over the JSONC object in `existing` (`{}` for a missing or blank file) and returns the text it makes, a
 * blank file ending in a newline. A file that is not valid JSONC, or holds no object, is left as it is with the
 * reason as its repair, and so is one `edit` refuses.
 */
export function editJsonc(
  existing: string | null,
  edit: (text: string, formatting: Formatting) => Edited,
): RegionResult {
  const current = existing ?? "";
  const isFresh = current.trim() === "";
  const text = isFresh ? "{}" : current;
  const kept = unusable(text);

  if (kept !== null) return { repairs: [kept], text };
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const edited = edit(text, { eol, insertSpaces: true, tabSize: INDENT });

  if ("repair" in edited) return { repairs: [edited.repair], text };

  return { repairs: [], text: isFresh ? `${edited.text}${eol}` : edited.text };
}
