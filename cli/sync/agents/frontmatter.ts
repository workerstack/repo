/**
 * Markdown-with-frontmatter in and out for the agent generators. Parsing is YAML 1.2 (`yes` stays a string);
 * emitting covers the shapes agent files use: scalars, scalar lists as block sequences and nested maps.
 */
import { parse } from "yaml";

import {
  CLAUDE_ANYWHERE,
  CLAUDE_FIRST,
  COLON_SPACE,
  CR_LINE_ENDS,
  FENCE,
  INDENT,
  INDICATOR_FIRST,
  INDICATOR_SPACED,
  LEADING_BOM,
  NEEDS_ESCAPES,
  NOT_FOUND,
  SPACE_HASH,
  TRAILING_COLON,
  YAML_11_TYPED,
} from "./frontmatter.constants.ts";

/** A frontmatter document: the YAML mapping with nullish values removed, and the trimmed body. */
export type ParsedDoc = {
  data: Record<string, unknown>;
  body: string;
};

type YamlScalar = string | number | boolean;
type YamlList = readonly (YamlScalar | null | undefined)[];
/** `null` and `undefined` are dropped at every level, as rulesync did. */
export type YamlValue = YamlScalar | YamlList | YamlMap | null | undefined;
type YamlMap = {
  readonly [key: string]: YamlValue;
};

/**
 * How strings are quoted. `default` quotes only what YAML would misread. `claude` also quotes any string holding
 * `,` `[` `]` `{` `}` or `:`, or starting with `-` `?` `=`, as the YAML 1.1 dumper behind the committed
 * `.claude/agents` files did.
 */
export type YamlMode = "default" | "claude";

function toLf(text: string): string {
  return text.replaceAll(CR_LINE_ENDS, "\n");
}

function isMap(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A value with its nullish entries dropped: list items, and map values at every level. */
function cleaned(value: unknown): unknown {
  if (Array.isArray(value)) return value.filter((item) => item !== null && item !== undefined);
  return isMap(value) ? dropNullish(value) : value;
}

function dropNullish(map: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(map)) if (value !== null && value !== undefined) out[key] = cleaned(value);
  return out;
}

/** The YAML between the fences, parsed; throws an Error naming `rel` and the first line of the YAML error. */
function parseYaml(rel: string, yaml: string): unknown {
  try {
    return parse(yaml);
  } catch (error) {
    // The first line already names the line and column; the rest is a source excerpt that would split the message.
    const failure = error /* yaml's parse throws only Error subclasses */ as Error;
    const first = failure.message.split("\n")[0] /* split always yields a first piece */ as string;
    const reason = first.trim().replace(TRAILING_COLON, "");
    throw new Error(`${rel}: invalid frontmatter: ${reason}`, { cause: error });
  }
}

/** Parse `text` (the file at repo-relative POSIX `rel`); throws an Error whose message starts with `rel`. */
export function parseDoc(rel: string, text: string): ParsedDoc {
  const lines = toLf(text).replace(LEADING_BOM, "").split("\n");
  if (lines[0]?.trimEnd() !== FENCE) throw new Error(`${rel}: missing frontmatter (start the file with a --- block)`);
  const close = lines.findIndex((line, i) => i > 0 && line.trimEnd() === FENCE);
  if (close === NOT_FOUND) throw new Error(`${rel}: invalid frontmatter: no closing --- line`);
  const raw = parseYaml(rel, lines.slice(1, close).join("\n"));
  if (raw !== null && !isMap(raw)) throw new Error(`${rel}: invalid frontmatter: expected a mapping`);
  return {
    body: lines
      .slice(close + 1)
      .join("\n")
      .trim(),
    data: raw === null ? {} : dropNullish(raw),
  };
}

/** Block-style YAML for `entries` in the order given, ending in `\n`; `""` when every value is nullish. */
export function emitYaml(entries: Iterable<readonly [string, YamlValue]>, mode: YamlMode = "default"): string {
  return emitMap(entries, mode, "");
}

/** Where an entry is written: its `key:` head, the indent it sits at and the quoting mode. */
type EntryAt = { head: string; indent: string; mode: YamlMode };

/** One entry's lines: a list as a block sequence, a map nested a level deeper, a scalar inline. */
function emitEntry(value: YamlScalar | YamlList | YamlMap, { head, indent, mode }: EntryAt): string {
  if (Array.isArray(value)) {
    const list = value /* Array.isArray narrows a YamlValue only to a list */ as YamlList;
    const items = list.filter((item) => item !== null && item !== undefined);
    if (items.length === 0) return `${head} []\n`;
    return `${head}\n${items.map((item) => `${indent}${INDENT}- ${scalar(item, mode)}\n`).join("")}`;
  }
  if (typeof value === "object") {
    const map = value /* an object YamlValue that is not a list is a map */ as YamlMap;
    const body = emitMap(Object.entries(map), mode, `${indent}${INDENT}`);
    return body === "" ? `${head} {}\n` : `${head}\n${body}`;
  }
  return `${head} ${scalar(value, mode)}\n`;
}

function emitMap(entries: Iterable<readonly [string, YamlValue]>, mode: YamlMode, indent: string): string {
  let out = "";
  for (const [key, value] of entries) {
    if (value === null || value === undefined) continue;
    out += emitEntry(value, { head: `${indent}${scalar(key, mode)}:`, indent, mode });
  }
  return out;
}

function scalar(value: YamlScalar, mode: YamlMode): string {
  if (typeof value === "boolean") return String(value);
  if (typeof value === "number") {
    if (Number.isNaN(value)) return ".nan";
    if (!Number.isFinite(value)) return value > 0 ? ".inf" : "-.inf";
    return String(value);
  }
  // Newlines and control characters need escapes; a JSON string is a valid YAML double-quoted scalar.
  if (NEEDS_ESCAPES.test(value)) return JSON.stringify(value);
  return needsQuotes(value, mode) ? `'${value.replaceAll("'", "''")}'` : value;
}

/** Whether YAML would misread `value` by its indicators, its `: ` or its ` #`. */
function hasIndicator(value: string): boolean {
  if (INDICATOR_FIRST.test(value) || INDICATOR_SPACED.test(value)) return true;
  return COLON_SPACE.test(value) || SPACE_HASH.test(value);
}

function needsQuotes(value: string, mode: YamlMode): boolean {
  if (value === "" || value !== value.trim() || hasIndicator(value)) return true;
  if (mode === "claude" && (CLAUDE_ANYWHERE.test(value) || CLAUDE_FIRST.test(value))) return true;
  if (YAML_11_TYPED.test(value)) return true;
  return readsAsSomethingElse(value);
}

function readsAsSomethingElse(value: string): boolean {
  try {
    return parse(value) !== value;
  } catch {
    return true;
  }
}

/** One file's final text: LF only, trailing whitespace trimmed, exactly one trailing `\n`. */
export function finalize(text: string): string {
  return `${toLf(text).trimEnd()}\n`;
}
