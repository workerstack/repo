/** The small YAML reader the maps read skill and reference frontmatter with. */
import { z } from "zod";

import { readJson } from "../json.ts";
import { splitFrontmatter } from "../scripts/emit-agent-shell-tools.ts";
import { QUOTED_MIN } from "./maps.constants.ts";

/** A frontmatter value as the reader produces it. */
export type YamlValue = string | string[] | YamlObject;

export type YamlObject = {
  [key: string]: YamlValue;
};

/** The lines of a frontmatter block and the index of the next one to read. */
type Cursor = { readonly lines: readonly string[]; i: number };

const KEY_LINE = /^([^:#\s][^:]*):\s*(.*?)\s*$/;
const LEADING_INDENT = /^[ \t]*/;
const LIST_MARK = /^- /;
const COMMENT_LINE = /^\s*#/;
const LINE_BREAK = /\r?\n/;

/** Whether `s` starts and ends with `quote` and holds both. */
function quotedBy(s: string, quote: string): boolean {
  return s.length >= QUOTED_MIN && s.startsWith(quote) && s.endsWith(quote);
}

/** `s` without its first and last character. */
function unwrapped(s: string): string {
  return s.slice(1, s.length - 1);
}

function unquoteYaml(raw: string): string {
  const s = raw.trim();

  if (quotedBy(s, '"')) {
    try {
      return readJson(z.string(), s);
    } catch {
      return unwrapped(s);
    }
  }

  if (quotedBy(s, "'")) return unwrapped(s).replaceAll("''", "'");

  return s;
}

/** The items of a `[a, b]` flow sequence; null for any other value. */
export function parseFlowSeq(s: string): string[] | null {
  const t = s.trim();

  if (!t.startsWith("[") || !t.endsWith("]")) return null;
  const items = unwrapped(t).trim();

  if (items === "") return [];

  return items
    .split(",")
    .map((x) => unquoteYaml(x.trim()))
    .filter((x) => x !== "");
}

function indentOf(line: string): number {
  return line.length - line.replace(LEADING_INDENT, "").length;
}

function more(c: Cursor): boolean {
  return c.i < c.lines.length;
}

/** The line the cursor is on; every caller checks `more` first. */
function current(c: Cursor): string {
  return c.lines[c.i] /* every caller checks more() first */ as string;
}

/** A `>` or `|` block: the lines indented past `ind`, joined by spaces. */
function folded(c: Cursor, ind: number): string {
  const parts: string[] = [];

  while (more(c)) {
    const n = current(c);

    if (n.trim() !== "" && indentOf(n) <= ind) break;
    parts.push(n.trim());
    c.i += 1;
  }

  return parts.filter(Boolean).join(" ");
}

/** The `- item` lines indented past `ind`. */
function blockList(c: Cursor, ind: number): string[] {
  const arr: string[] = [];

  while (more(c) && indentOf(current(c)) > ind && current(c).trim().startsWith("- ")) {
    arr.push(unquoteYaml(current(c).trim().replace(LIST_MARK, "")));
    c.i += 1;
  }

  return arr;
}

/** The value of a key with nothing after its colon: a list or a map on the lines indented past `ind`, else `{}`. */
function nested(c: Cursor, ind: number): YamlValue {
  if (!more(c) || indentOf(current(c)) <= ind) return {};

  if (current(c).trim().startsWith("- ")) return blockList(c, ind);

  return parseBlock(c, indentOf(current(c)));
}

/** The value of a key at indent `ind` whose line holds `val` after its colon. */
function valueOf(c: Cursor, val: string, ind: number): YamlValue {
  if (val === ">" || val === "|") return folded(c, ind);

  if (val === "") return nested(c, ind);

  return parseFlowSeq(val) ?? unquoteYaml(val);
}

/** The keys at indent `base` from the cursor on, until a line indented less (or, nested, more). */
function parseBlock(c: Cursor, base: number) {
  const obj: YamlObject = {};

  while (more(c)) {
    const line = current(c);
    const skipped = line.trim() === "" || COMMENT_LINE.test(line);
    const ind = indentOf(line);

    if (!skipped && (ind < base || (base > 0 && ind > base))) break;
    c.i += 1;
    const trimmed = line.trim();

    if (skipped || !KEY_LINE.test(trimmed)) continue;
    // The pattern ends the key at its first colon and trims the value around it.
    const colon = trimmed.indexOf(":");
    obj[trimmed.slice(0, colon).trim()] = valueOf(c, trimmed.slice(colon + 1).trim(), ind);
  }

  return obj;
}

/** A markdown file's parsed frontmatter and the body after it. */
export type ParsedMarkdown = { parsed: YamlObject; body: string };

/** The frontmatter and body of a markdown file; no frontmatter reads as `{}`. */
export function parseMarkdown(src: string): ParsedMarkdown {
  const split = splitFrontmatter(src);

  if (!split.ok) return { body: src, parsed: {} };

  return { body: split.body, parsed: parseBlock({ i: 0, lines: split.fm.split(LINE_BREAK) }, 0) };
}
