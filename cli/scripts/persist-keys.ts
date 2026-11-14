import { FM_OPEN, NOT_FOUND } from "./persist-doc.constants.ts";
/** The `strategy:`, `advice:` and `approval:` keys a plan or roadmap save sends, in frontmatter or as a body line. */
import { hasKey, parseFrontmatter, type FrontmatterMap, stripBom } from "./persist-doc.ts";
import { fencedLineSet } from "./persist-sections.ts";
import { APPROVALS, STRATEGIES } from "./strategy.constants.ts";
import { parseApprovalSetting, parseStrategy } from "./strategy.ts";
import type { Strategy } from "./strategy.types.ts";

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
function extractKey(content: string, key: string): string | undefined {
  const text = stripBom(content);

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
function stripKeyLine(content: string, key: string): string {
  const lines = content.split("\n");
  const at = keyLineAt(lines, key);

  if (at !== NOT_FOUND) lines.splice(at, 1);

  return lines.join("\n");
}

/** The `strategy:` value a save sends, in its frontmatter or as a body line; undefined when absent. */
export function extractStrategy(content: string): string | undefined {
  return extractKey(content, "strategy");
}

/** `content` without its first `strategy:` line outside a code fence. */
export function stripStrategyLine(content: string): string {
  return stripKeyLine(content, "strategy");
}

/** The `approval:` value a save sends, in its frontmatter or as a body line; undefined when absent. */
export function extractApproval(content: string): string | undefined {
  return extractKey(content, "approval");
}

/** `content` without its first `approval:` line outside a code fence. */
export function stripApprovalLine(content: string): string {
  return stripKeyLine(content, "approval");
}

/** The `advice:` value a save sends, in its frontmatter or as a body line; undefined when absent. */
export function extractAdvice(content: string): string | undefined {
  return extractKey(content, "advice");
}

/** `content` without its first `advice:` line outside a code fence. */
export function stripAdviceLine(content: string): string {
  return stripKeyLine(content, "advice");
}

/** The retired `mode:` value a save sends; kept so validation can refuse it with what replaced it. */
export function extractRetiredMode(content: string): string | undefined {
  return extractKey(content, "mode");
}

/** `approval` is optional; when sent it must be one of APPROVALS. */
function approvalError(): string {
  return `approval: ${APPROVALS.join("|")}`;
}

/** Errors for a frontmatter's approval: the old `mode` key says what replaced it; else a bad value, none if absent. */
export function approvalErrors(map: FrontmatterMap): string[] {
  if (hasKey(map, "mode")) return [`mode: is now approval:; use ${approvalError()}`];

  if (!hasKey(map, "approval")) return [];

  return parseApprovalSetting(map.approval) === null ? [approvalError()] : [];
}

/** `strategy` must be one of the three values. */
export function strategyError(): string {
  return `strategy: ${STRATEGIES.join("|")}`;
}

const ADVICE_MAX = 100;
const ADVICE_RE = /^(\S+) because \S/;

function adviceLine(): string {
  return `advice: {${STRATEGIES.join("|")}} because {reason}`;
}

function adviceError(): string {
  return `${adviceLine()}, at most ${ADVICE_MAX} characters`;
}

/** Errors for a frontmatter's advice: optional; when sent `{strategy} because {reason}` within the length cap. */
export function adviceErrors(map: FrontmatterMap): string[] {
  if (!hasKey(map, "advice")) return [];
  const value = String(map.advice);
  const word = ADVICE_RE.exec(value)?.[1];

  return value.length <= ADVICE_MAX && parseStrategy(word) !== null ? [] : [adviceError()];
}

/**
 * The refusal for an agent's `strategy:` line: it is set from the session, the roadmap or the config. Null when the
 * content sends none, or one equal to `saved`, the value the file already holds.
 */
export function agentStrategyError(content: string, saved: Strategy | null): string | null {
  const sent = extractStrategy(content);

  if (sent === undefined || sent === saved) return null;

  return `strategy: is set from the session, the roadmap or the config; send ${adviceLine()}`;
}
