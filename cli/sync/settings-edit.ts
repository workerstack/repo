import { applyEdits, modify, parse, printParseErrorCode, type ParseError } from "jsonc-parser";

import { byCodeUnit } from "./by-code-unit.ts";

const READONLY_KEY = "files.readonlyInclude";

/**
 * The `.vscode/settings.json` text with `files.readonlyInclude` set to `paths`, every other key and comment as
 * written, and the repair that explains it when the file is left as is: not valid JSONC, or holding no object.
 */
export function settingsEdit(existing: string | null, paths: readonly string[]): { repairs: string[]; text: string } {
  const current = existing ?? "";
  const isFresh = current.trim() === "";
  const text = isFresh ? "{}" : current;
  const kept = unusable(text);
  if (kept !== null) return { repairs: [kept], text };
  const readonly = Object.fromEntries(paths.toSorted(byCodeUnit).map((rel) => [rel, true]));
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  // Inserted first, the new key leaves every neighbour's whitespace as written; appended, its formatting would
  // rewrite the last one's.
  const options = { formattingOptions: { eol, insertSpaces: true, tabSize: 2 }, getInsertionIndex: () => 0 };
  const edited = applyEdits(text, modify(text, [READONLY_KEY], readonly, options));
  return { repairs: [], text: isFresh ? `${edited}${eol}` : edited };
}

/** Why settings `text` is left as is, naming the line of its first JSONC error; null when it holds an object. */
function unusable(text: string): string | null {
  const problems: ParseError[] = [];
  const value: unknown = parse(text, problems, { allowTrailingComma: true });
  const [problem] = problems;
  if (problem !== undefined) {
    const line = text.slice(0, problem.offset).split("\n").length;
    return `not valid JSONC at line ${line} (${printParseErrorCode(problem.error)}); left as is`;
  }
  const object = typeof value === "object" && value !== null && !Array.isArray(value);
  return object ? null : "must hold a JSON object; left as is";
}
