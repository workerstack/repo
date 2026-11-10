/** What every saved doc kind (plan, roadmap, handoff, journal, tmp file) shares: results, frontmatter, names, stamps, serials. */
import fs from "node:fs";
import path from "node:path";
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

/** Frontmatter `key: value` lines, values as strings. */
export type FrontmatterMap = Record<string, string>;

/** `## ` heading order and section bodies of a document. */
export interface Sections {
  order: string[];
  bodies: Record<string, string>;
}

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

export function slugify(name: unknown): string {
  const s = String(name || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  const cut = s.length > SLUG_MAX ? s.slice(0, SLUG_MAX).replace(/-+$/g, "") : s;
  return cut || "unnamed";
}

export function utcDateTime(d: Date = new Date()): string {
  return d.toISOString().replace(MILLIS_RE, "Z");
}

export function utcDate(d: Date = new Date()): string {
  return utcDateTime(d).slice(0, DATE_LENGTH);
}

export function compactCreatedStamp(created: unknown): string {
  return String(created).replace(/[-:]/g, "");
}

/** The slug in `{serial}-{slug}-{stamp}.md`; an unstamped name works too. */
export function slugFromFilename(filename: unknown): string {
  return String(filename)
    .replace(/\.md$/, "")
    .replace(/^[0-9]+-/, "")
    .replace(FILENAME_STAMP_RE, "");
}

export function extractH1(content: unknown): string {
  const m = String(content).match(H1_RE);
  return m ? captured(m, 1).trim() : "";
}

/** The next serial for a file in `dir` whose name ends in `suffix` (any entry when ""); 1 when `dir` is missing. */
export function nextSerial(dir: string, suffix = ".md"): number {
  if (!fs.existsSync(dir)) return 1;
  let next = 1;
  for (const b of fs.readdirSync(dir)) {
    const m = b.endsWith(suffix) ? SERIAL_PREFIX_RE.exec(b) : null;
    if (m) next = Math.max(next, parseInt(captured(m, 1), DECIMAL) + 1);
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
    if (v.startsWith('"') && v.endsWith('"')) {
      try {
        v = String(JSON.parse(v));
      } catch {
        v = v.slice(1, v.length - 1);
      }
    }
    map[key] = v;
  }
  return map;
}

export function parseFrontmatter(text: string): FrontmatterResult {
  if (!text.startsWith(FM_OPEN)) return { error: "missing frontmatter" };
  const end = text.indexOf(FM_CLOSE, FM_OPEN.length);
  if (end === NOT_FOUND) return { error: "unterminated frontmatter" };
  return { map: frontmatterMap(text.slice(FM_OPEN.length, end)), body: text.slice(end + FM_CLOSE.length) };
}

/** `text` without a leading byte-order mark and frontmatter block. */
export function stripFrontmatter(text: unknown): string {
  const s = String(text).replace(/^﻿/, "");
  const end = s.startsWith(FM_OPEN) ? s.indexOf(FM_CLOSE, FM_OPEN.length) : NOT_FOUND;
  return end === NOT_FOUND ? s : s.slice(end + FM_CLOSE.length);
}

/** The `source:` line: JSON-quoted, cut to the limit. */
export function sourceLine(source: unknown): string {
  return `source: ${JSON.stringify(String(source || "").slice(0, SOURCE_MAX))}`;
}

/** The `created:` line, now when none is given. */
export function createdLine(created: string | undefined): string {
  return `created: ${created || utcDateTime()}`;
}

/** `lines` (the ordered `key: value` lines a kind writes) as frontmatter over `body`, whose first heading becomes `# slug`. */
export function injectFrontmatter(lines: string[], slug: string, body: string): string {
  const trimmed = body.replace(/^\s+/, "");
  const rest = trimmed.startsWith("# ") ? trimmed.replace(/^# .+/, `# ${slug}`) : `# ${slug}\n\n${trimmed}`;
  return `${FM_OPEN}${lines.join("\n")}${FM_CLOSE}\n${rest}`;
}

/** `created` when it is a full UTC datetime, else now. */
export function createdAtOf(created: string | undefined): string {
  return created && DATETIME_RE.test(created) ? created : utcDateTime();
}

/** A free `{serial}-{slug}-{stamp}.{ext}` in `dir`, counting up from `first`; undefined after `NAME_TRIES` taken names. */
export function freeName(
  dir: string,
  { first, slug, stamp, ext = "md" }: { first: number; slug: string; stamp: string; ext?: string },
): { serial: number; filename: string; dest: string } | undefined {
  for (let tried = 0; tried <= NAME_TRIES; tried += 1) {
    const serial = first + tried;
    const filename = `${serial}-${slug}-${stamp}.${ext}`;
    const dest = path.join(dir, filename);
    if (!fs.existsSync(dest)) return { serial, filename, dest };
  }
  return undefined;
}
