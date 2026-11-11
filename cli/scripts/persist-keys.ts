import { FM_OPEN, NOT_FOUND } from "./persist-doc.constants.ts";
/** The `strategy:` and `mode:` keys a plan or roadmap save sends in its frontmatter or as a body line. */
import { hasKey, parseFrontmatter, type FrontmatterMap, stripBom } from "./persist-doc.ts";
import { fencedLineSet } from "./persist-sections.ts";
import { MODES, STRATEGIES } from "./strategy.constants.ts";
import { parseMode } from "./strategy.ts";

/** Index of the first `{key}:` line outside a code fence, else -1. */
function keyLineAt(lines: string[], key: string): number {
  const { fenced } = fencedLineSet(lines);
  const re = new RegExp(`^${key}:`);
  return lines.findIndex((l, i) => !fenced.has(i) && re.test(l));
}

/**
 * The `{key}:` value a save sends, in its frontmatter or as a body line outside a code fence; undefined when
 * absent.
 */
function extractKey(content: unknown, key: string): string | undefined {
  const text = stripBom(String(content));
  if (text.startsWith(FM_OPEN)) {
    const fm = parseFrontmatter(text);
    if (fm.error === undefined && hasKey(fm.map, key)) return fm.map[key];
  }
  const lines = text.split("\n");
  const at = keyLineAt(lines, key);
  return at === NOT_FOUND
    ? undefined
    : String(lines[at])
        .replace(new RegExp(`^${key}:\\s*`), "")
        .trim();
}

/** `content` without its first `{key}:` line outside a code fence. */
function stripKeyLine(content: unknown, key: string): string {
  const lines = String(content).split("\n");
  const at = keyLineAt(lines, key);
  if (at !== NOT_FOUND) lines.splice(at, 1);
  return lines.join("\n");
}

/** The `strategy:` value a save sends, in its frontmatter or as a body line; undefined when absent. */
export function extractStrategy(content: unknown): string | undefined {
  return extractKey(content, "strategy");
}

/** `content` without its first `strategy:` line outside a code fence. */
export function stripStrategyLine(content: unknown): string {
  return stripKeyLine(content, "strategy");
}

/** The `mode:` value a save sends, in its frontmatter or as a body line; undefined when absent. */
export function extractMode(content: unknown): string | undefined {
  return extractKey(content, "mode");
}

/** `content` without its first `mode:` line outside a code fence. */
export function stripModeLine(content: unknown): string {
  return stripKeyLine(content, "mode");
}

/** `mode` is optional; when sent it must be one of the three values. */
function modeError(): string {
  return `mode: ${MODES.join("|")}`;
}

/** Errors for a frontmatter's `mode`: none when absent, the mode error when present and not one of MODES. */
export function modeErrors(map: FrontmatterMap): string[] {
  if (!hasKey(map, "mode")) return [];
  return parseMode(map.mode) === null ? [modeError()] : [];
}

/** `strategy` must be one of the three values. */
export function strategyError(): string {
  return `strategy: ${STRATEGIES.join("|")}`;
}
