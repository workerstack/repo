/**
 * What every saved doc kind (plan, roadmap, handoff, journal, tmp file) shares: results, frontmatter, names, stamps,
 * serials.
 */
import fs from "node:fs";
import path from "node:path";

import { z } from "zod";

import { tryJson } from "../json.ts";
import { firstNonEmpty } from "./first-non-empty.ts";
import {
  DATETIME_RE,
  DATE_LENGTH,
  DECIMAL,
  FILENAME_STAMP_RE,
  FM_CLOSE,
  FM_LINE_RE,
  FM_OPEN,
  H1_RE,
  NAME_TRIES,
  MILLIS_RE,
  NOT_FOUND,
  SERIAL_PREFIX_RE,
  SLUG_MAX,
  SOURCE_MAX,
} from "./persist-doc.constants.ts";

const NON_SLUG_RUN_RE = /[^a-z0-9]+/g;
const DASH_RUN_RE = /-+/g;
const EDGE_DASHES_RE = /^-+|-+$/g;
const TRAILING_DASHES_RE = /-+$/g;
const STAMP_PUNCT_RE = /[-:]/g;
const MD_EXT_RE = /\.md$/;
const SERIAL_DASH_RE = /^[0-9]+-/;
const BOM_RE = /^\uFEFF/;
const LEADING_SPACE_RE = /^\s+/;
const H1_LINE_RE = /^# .+/;

/** Frontmatter `key: value` lines, values as strings. */
export type FrontmatterMap = Record<string, string>;

/** `## ` heading order and section bodies of a document. */
export type Sections = {
  order: string[];
  bodies: Record<string, string>;
};

export type FrontmatterResult =
  | { error: string; map?: undefined; body?: undefined }
  | { error?: undefined; map: FrontmatterMap; body: string };

/**
 * A persist outcome: `ok` with the written file's fields, or not ok with `error` (and `errors` when several).
 * Each side lists the other's fields as `undefined`, so a reader can touch any field before narrowing on `ok`.
 */
export type PersistResult<T> =
  | ({ ok: true; error?: undefined; errors?: undefined } & T)
  | ({ ok: false; error: string; errors?: string[] } & { [K in keyof T]?: undefined });

/** Whether a frontmatter map carries `key`, even with an empty value. */
export function hasKey(map: FrontmatterMap, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(map, key);
}

/** A capture group its pattern requires, so it is always set. */
export function captured(match: ArrayLike<string | undefined>, index: number): string {
  return String(match[index]);
}

export function slugify(name: string): string {
  const s = name
    .toLowerCase()
    .replaceAll(NON_SLUG_RUN_RE, "-")
    .replaceAll(DASH_RUN_RE, "-")
    .replaceAll(EDGE_DASHES_RE, "");

  const cut = s.length > SLUG_MAX ? s.slice(0, SLUG_MAX).replaceAll(TRAILING_DASHES_RE, "") : s;

  return firstNonEmpty(cut) ?? "unnamed";
}

export function utcDateTime(d: Date = new Date()): string {
  return d.toISOString().replace(MILLIS_RE, "Z");
}

export function utcDate(d: Date = new Date()): string {
  return utcDateTime(d).slice(0, DATE_LENGTH);
}

export function compactCreatedStamp(created: unknown): string {
  return String(created).replaceAll(STAMP_PUNCT_RE, "");
}

/** The slug in `{serial}-{slug}-{stamp}.md`; an unstamped name works too. */
export function slugFromFilename(filename: unknown): string {
  return String(filename).replace(MD_EXT_RE, "").replace(SERIAL_DASH_RE, "").replace(FILENAME_STAMP_RE, "");
}

export function extractH1(content: unknown): string {
  const m = String(content).match(H1_RE);

  return m === null ? "" : captured(m, 1).trim();
}

/** The next serial for a file in `dir` whose name ends in `suffix` (any entry when ""); 1 when `dir` is missing. */
export function nextSerial(dir: string, suffix = ".md"): number {
  if (!fs.existsSync(dir)) return 1;
  let next = 1;

  for (const b of fs.readdirSync(dir)) {
    const m = b.endsWith(suffix) ? SERIAL_PREFIX_RE.exec(b) : null;

    if (m !== null) next = Math.max(next, parseInt(captured(m, 1), DECIMAL) + 1);
  }

  return next;
}

/** `key: value` lines of a frontmatter block as strings; a quoted value is JSON-decoded when it parses. */
export function frontmatterMap(raw: string, lineRe: RegExp = FM_LINE_RE): FrontmatterMap {
  const map: FrontmatterMap = {};

  for (const line of raw.split("\n")) {
    const [, key, value = ""] = lineRe.exec(line) ?? [];

    if (key === undefined) continue;
    let v = value;

    if (v.startsWith('"') && v.endsWith('"')) v = tryJson(z.string(), v) ?? v.slice(1, v.length - 1);

    map[key] = v;
  }

  return map;
}

export function parseFrontmatter(text: string): FrontmatterResult {
  if (!text.startsWith(FM_OPEN)) return { error: "missing frontmatter" };
  const end = text.indexOf(FM_CLOSE, FM_OPEN.length);

  if (end === NOT_FOUND) return { error: "unterminated frontmatter" };

  return { body: text.slice(end + FM_CLOSE.length), map: frontmatterMap(text.slice(FM_OPEN.length, end)) };
}

/** `text` without a leading byte-order mark. */
export function stripBom(text: string): string {
  return text.replace(BOM_RE, "");
}

/** `text` without a leading byte-order mark and frontmatter block. */
export function stripFrontmatter(text: unknown): string {
  const s = stripBom(String(text));
  const end = s.startsWith(FM_OPEN) ? s.indexOf(FM_CLOSE, FM_OPEN.length) : NOT_FOUND;

  return end === NOT_FOUND ? s : s.slice(end + FM_CLOSE.length);
}

/** The `source:` line: JSON-quoted, cut to the limit. */
export function sourceLine(source: string | undefined): string {
  return `source: ${JSON.stringify((source ?? "").slice(0, SOURCE_MAX))}`;
}

/** The `created:` line, now when none is given. */
export function createdLine(created: string | undefined): string {
  return `created: ${firstNonEmpty(created) ?? utcDateTime()}`;
}

/**
 * `lines` (the ordered `key: value` lines a kind writes) as frontmatter over `body`, whose first heading becomes
 * `# slug`.
 */
export function injectFrontmatter(lines: string[], slug: string, body: string): string {
  return `${FM_OPEN}${lines.join("\n")}${FM_CLOSE}\n${retitled(body, slug)}`;
}

/** `body` without leading whitespace, its first heading made `# slug` (added on top when it has none). */
export function retitled(body: string, slug: string): string {
  const trimmed = body.replace(LEADING_SPACE_RE, "");

  return trimmed.startsWith("# ") ? trimmed.replace(H1_LINE_RE, `# ${slug}`) : `# ${slug}\n\n${trimmed}`;
}

/** `created` when it is a full UTC datetime, else now. */
export function createdAtOf(created: string | undefined): string {
  return created !== undefined && DATETIME_RE.test(created) ? created : utcDateTime();
}

/**
 * A free `{serial}-{slug}-{stamp}.{ext}` in `dir`, counting up from `first`; undefined after `NAME_TRIES` taken
 * names.
 */
export function freeName(
  dir: string,
  { first, slug, stamp, ext = "md" }: { first: number; slug: string; stamp: string; ext?: string },
): { serial: number; filename: string; dest: string } | undefined {
  for (let tried = 0; tried <= NAME_TRIES; tried += 1) {
    const serial = first + tried;
    const filename = `${serial}-${slug}-${stamp}.${ext}`;
    const dest = path.join(dir, filename);

    if (!fs.existsSync(dest)) return { dest, filename, serial };
  }

  return undefined;
}
