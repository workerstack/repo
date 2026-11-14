import { FM_OPEN, NOT_FOUND } from "./persist-doc.constants.ts";
/** The `strategy:` and `approval:` keys a plan or roadmap save sends in its frontmatter or as a body line. */
import { hasKey, parseFrontmatter, type FrontmatterMap, stripBom } from "./persist-doc.ts";
import { fencedLineSet } from "./persist-sections.ts";
import { APPROVALS, STRATEGIES } from "./strategy.constants.ts";
import { parseApprovalSetting } from "./strategy.ts";

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
