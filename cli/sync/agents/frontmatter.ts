/**
 * Markdown-with-frontmatter in and out for the agent generators. Parsing is YAML 1.2 (`yes` stays a string);
 * emitting covers the shapes agent files use: scalars, scalar lists as block sequences and nested maps.
 */
import { parse } from "yaml";

/** A frontmatter document: the YAML mapping with nullish values removed, and the trimmed body. */
export type ParsedDoc = {
  data: Record<string, unknown>;
  body: string;
};

type YamlScalar = string | number | boolean;
/** `null` and `undefined` are dropped at every level, as rulesync did. */
export type YamlValue = YamlScalar | readonly (YamlScalar | null | undefined)[] | YamlMap | null | undefined;
export type YamlMap = {
  readonly [key: string]: YamlValue;
};

/**
 * How strings are quoted. `default` quotes only what YAML would misread. `claude` also quotes any string holding
 * `,` `[` `]` `{` `}` or `:`, or starting with `-` `?` `=`, as the YAML 1.1 dumper behind the committed
 * `.claude/agents` files did.
 */
export type YamlMode = "default" | "claude";

const FENCE = "---";

function toLf(text: string): string {
  return text.replaceAll(/\r\n?/g, "\n");
}

/** Parse `text` (the file at repo-relative POSIX `rel`); throws an Error whose message starts with `rel`. */
export function parseDoc(rel: string, text: string): ParsedDoc {
  const lines = toLf(text)
    .replace(/^\uFEFF/, "")
    .split("\n");
  if (lines[0]?.trimEnd() !== FENCE) throw new Error(`${rel}: missing frontmatter (start the file with a --- block)`);
  const close = lines.findIndex((line, i) => i > 0 && line.trimEnd() === FENCE);
  if (close === -1) throw new Error(`${rel}: invalid frontmatter: no closing --- line`);
  let raw: unknown;
  try {
    raw = parse(lines.slice(1, close).join("\n"));
  } catch (error) {
    // The first line already names the line and column; the rest is a source excerpt that would split the message.
    const reason = (error as Error).message.split("\n")[0]!.trim().replace(/:$/, "");
    throw new Error(`${rel}: invalid frontmatter: ${reason}`, { cause: error });
  }
  if (raw !== null && !isMap(raw)) throw new Error(`${rel}: invalid frontmatter: expected a mapping`);
  return {
    body: lines
      .slice(close + 1)
      .join("\n")
      .trim(),
    data: raw === null ? {} : dropNullish(raw),
  };
}

function isMap(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function dropNullish(map: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(map)) {
    if (value === null || value === undefined) continue;
    out[key] = Array.isArray(value)
      ? value.filter((item) => item !== null && item !== undefined)
      : isMap(value)
        ? dropNullish(value)
        : value;
  }
  return out;
}

/** Block-style YAML for `entries` in the order given, ending in `\n`; `""` when every value is nullish. */
export function emitYaml(entries: Iterable<readonly [string, YamlValue]>, mode: YamlMode = "default"): string {
  return emitMap(entries, mode, "");
}

function emitMap(entries: Iterable<readonly [string, YamlValue]>, mode: YamlMode, indent: string): string {
  let out = "";
  for (const [key, value] of entries) {
    if (value === null || value === undefined) continue;
    const head = `${indent}${scalar(key, mode)}:`;
    if (Array.isArray(value)) {
      const items = (value as readonly (YamlScalar | null | undefined)[]).filter(
        (item) => item !== null && item !== undefined,
      );
      out +=
        items.length === 0
          ? `${head} []\n`
          : `${head}\n${items.map((item) => `${indent}  - ${scalar(item, mode)}\n`).join("")}`;
    } else if (typeof value === "object") {
      const body = emitMap(Object.entries(value as YamlMap), mode, `${indent}  `);
      out += body === "" ? `${head} {}\n` : `${head}\n${body}`;
    } else {
      out += `${head} ${scalar(value, mode)}\n`;
    }
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
  if (/[\u0000-\u001f\u007f\u2028\u2029\uFEFF]/.test(value)) return JSON.stringify(value);
  return needsQuotes(value, mode) ? `'${value.replaceAll("'", "''")}'` : value;
}

/** Words and numbers a YAML 1.1 reader types though YAML 1.2 reads them as strings. */
const YAML_11_TYPED =
  /^(?:[yYnN]|yes|Yes|YES|no|No|NO|on|On|ON|off|Off|OFF|[-+]?[0-9][0-9_]*(?::[0-5]?[0-9])+(?:\.[0-9_]*)?|[-+]?(?:0b[01_]+|0x[0-9a-fA-F_]+|0[0-7_]+|[0-9][0-9_]*(?:\.[0-9_]*)?(?:[eE][-+]?[0-9]+)?|\.[0-9_]+(?:[eE][-+]?[0-9]+)?)|[0-9]{4}-[0-9]{1,2}-[0-9]{1,2}(?:[Tt ].*)?)$/;

function needsQuotes(value: string, mode: YamlMode): boolean {
  if (value === "" || value !== value.trim()) return true;
  if (/^[,[\]{}#&*!|>'"%@`]/.test(value) || /^[-?:](?:\s|$)/.test(value)) return true;
  if (/:(?:\s|$)/.test(value) || /\s#/.test(value)) return true;
  if (mode === "claude" && (/[,[\]{}:]/.test(value) || /^[-?=]/.test(value))) return true;
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
