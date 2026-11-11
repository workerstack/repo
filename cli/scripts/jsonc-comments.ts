/**
 * Own-line block comments in JSON with comments. `repo fmt` and turn's fmt step rewrite a `/* *\/` comment that is
 * alone on its lines in a `.json` or `.jsonc` file into `//` lines at the same indent, before the key sort; a comment
 * inside a line, a `/** *\/` doc, a leading `/*!` and any string holding `/*` stay. The text transform is
 * `commentLines` of `repo/no-block-comment`.
 */
import fs from "node:fs";
import path from "node:path";

import { createScanner } from "jsonc-parser";

import { commentLines } from "../lint/comment-lines.ts";
import { JSONC_EXTENSIONS } from "./json-keys.constants.ts";
import {
  BLOCK_CLOSE,
  BLOCK_COMMENT_TOKEN,
  BLOCK_OPEN,
  DOC_OPEN,
  EOF_TOKEN,
  FIXTURES_DIR,
  LICENSE_OPEN,
} from "./jsonc-comments.constants.ts";

/** A file with an own-line block comment, and the line of the first one. */
export type OwnLine = { file: string; line: number };
/** The text with its own-line block comments converted, and the line of the first one (null when none). */
type Converted = { text: string; first: number | null };

/** Where the own-line block comment `comment` at `offset` starts its line, or null when it is not one to convert. */
function ownLineStart(text: string, comment: string, offset: number): number | null {
  const docs = comment.startsWith(DOC_OPEN) && comment.length > DOC_OPEN.length + 1;
  const license = offset === 0 && comment.startsWith(LICENSE_OPEN);
  const start = text.lastIndexOf("\n", offset - 1) + 1;
  const end = offset + comment.length;
  const stop = text.indexOf("\n", end);
  const after = text.slice(end, stop < 0 ? text.length : stop);
  const alone = text.slice(start, offset).trim() === "" && after.trim() === "";
  return alone && !docs && !license ? start : null;
}

/** `text` with each own-line block comment rewritten as `//` lines, and the line of the first one. */
export function convertText(text: string): Converted {
  const scanner = createScanner(text, false);
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  let out = "";
  let copied = 0;
  let first: number | null = null;
  for (let kind = scanner.scan(); kind !== EOF_TOKEN; kind = scanner.scan()) {
    if (kind !== BLOCK_COMMENT_TOKEN) continue;
    const offset = scanner.getTokenOffset();
    const comment = text.slice(offset, offset + scanner.getTokenLength());
    const start = ownLineStart(text, comment, offset);
    if (start === null) continue;
    const indent = text.slice(start, offset);
    out +=
      text.slice(copied, offset) +
      commentLines(comment.slice(BLOCK_OPEN.length, comment.length - BLOCK_CLOSE.length), indent.length).join(
        `${eol}${indent}`,
      );
    copied = offset + comment.length;
    first ??= scanner.getTokenStartLine() + 1;
  }
  return { first, text: first === null ? text : out + text.slice(copied) };
}

/** The line of the first own-line block comment in `text`, or null. */
export const firstOwnLine = (text: string): number | null => convertText(text).first;

const inFixtures = (rel: string): boolean => rel.split("/").includes(FIXTURES_DIR);
const isJsonc = (rel: string): boolean => JSONC_EXTENSIONS.some((ext) => rel.endsWith(ext)) && !inFixtures(rel);

/**
 * Converts the own-line block comments of the json and jsonc `files` (relative to `root`; others, fixtures and gone
 * files are skipped) and returns each file that had one with its first line; under `check` nothing is written.
 */
export function convertJsonc(root: string, files: readonly string[], check: boolean): OwnLine[] {
  const found: OwnLine[] = [];
  for (const file of files.filter(isJsonc)) {
    const full = path.join(root, file);
    if (!fs.existsSync(full)) continue;
    const converted = convertText(fs.readFileSync(full, "utf8"));
    if (converted.first === null) continue;
    found.push({ file, line: converted.first });
    if (!check) fs.writeFileSync(full, converted.text);
  }
  return found;
}
