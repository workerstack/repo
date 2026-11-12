import { GOAL_H2, MISTAKES_H2, NOT_FOUND, USAGE_H2 } from "./persist-doc.constants.ts";
/** Checks on the `## ` sections of a plan or roadmap: fences, section bodies, Usage, the card and the line cap. */
import { captured, type Sections } from "./persist-doc.ts";

const FENCE_OPEN_RE = /^ {0,3}(`{3,}|~{3,})/;
const FENCE_CLOSE_RE = /^ {0,3}(`{3,}|~{3,})\s*$/;
const H2_RE = /^## (.+)$/;

type OpenFence = {
  char: string;
  length: number;
  line: number;
};

/** The fence a line opens, or null: a backtick fence whose info text holds a backtick is not one. */
function openingFence(line: string, at: number): OpenFence | null {
  const fence = FENCE_OPEN_RE.exec(line)?.[1];

  if (fence === undefined) return null;

  if (fence[0] === "`" && line.slice(line.indexOf(fence) + fence.length).includes("`")) return null;

  return { char: fence.charAt(0), length: fence.length, line: at + 1 };
}

/** Whether `line` closes `open`: the same character, at least as long, nothing after it. */
function closesFence(line: string, open: OpenFence): boolean {
  const fence = FENCE_CLOSE_RE.exec(line)?.[1] ?? "";

  return fence[0] === open.char && fence.length >= open.length;
}

/**
 * Lines inside CommonMark code fences, fence lines included. A fence closes only on the same
 * character, at least as long, with nothing after it. `unclosed` is the 1-based line of a fence
 * that never closes, else null.
 */
export function fencedLineSet(lines: string[]): { fenced: Set<number>; unclosed: number | null } {
  const fenced = new Set<number>();
  let open: OpenFence | null = null;

  for (const [i, line] of lines.entries()) {
    if (open !== null) {
      fenced.add(i);

      if (closesFence(line, open)) open = null;
      continue;
    }

    open = openingFence(line, i);

    if (open !== null) fenced.add(i);
  }

  return { fenced, unclosed: open === null ? null : open.line };
}

export function unclosedFenceErrors(text: unknown): string[] {
  const { unclosed } = fencedLineSet(String(text).split("\n"));

  return unclosed === null ? [] : [`unclosed code fence at line ${unclosed}: close it with the same fence`];
}

/** `## ` sections outside code fences, in order, with each body. */
export function sectionBodies(text: string): Sections {
  const lines = text.split("\n");
  const { fenced } = fencedLineSet(lines);
  const h2: { title: string; index: number; end: number }[] = [];
  let offset = 0;

  for (const [i, line] of lines.entries()) {
    const m = fenced.has(i) ? null : H2_RE.exec(line);

    if (m !== null) h2.push({ end: offset + line.length + 1, index: offset, title: captured(m, 1).trim() });
    offset += line.length + 1;
  }

  const bodies: Record<string, string> = {};

  for (const [i, cur] of h2.entries()) bodies[cur.title] = text.slice(cur.end, h2[i + 1]?.index ?? text.length);

  return { bodies, order: h2.map((h) => h.title) };
}

const USAGE_MISSING =
  "missing ## Usage after ## Goal: show what a person types and sees, before and after, in fenced blocks, " +
  'or one "No visible change:" line';

/**
 * `## Usage` shows what a person or agent types and sees: required right after Goal on a fresh
 * save, optional on an update to a file saved without it, and never prose alone.
 */
export function usageErrors(order: string[], bodies: Record<string, string>, { fresh }: { fresh: boolean }): string[] {
  const at = order.indexOf(USAGE_H2);

  if (at === NOT_FOUND) return fresh ? [USAGE_MISSING] : [];
  const errors: string[] = [];

  if (order[at - 1] !== GOAL_H2) errors.push("## Usage must come right after ## Goal");
  const lines = (bodies[USAGE_H2] ?? "").split("\n");
  const hasFence = fencedLineSet(lines).fenced.size > 0;

  if (!hasFence && !lines.some((l) => l.startsWith("No visible change:")))
    errors.push('## Usage needs a fenced example or a "No visible change:" line');

  return errors;
}

const CARD_LABELS = ["WHAT", "WHY", "RISK", "TOUCH", "DONE"] as const;
const CARD_WIDTH = 120;
const CARD_PAD = 7;

/** Index of the first card line: after the title and one blank line. */
const CARD_START = 2;
const CARD_LABEL_RE = /^(?:WHAT|WHY|RISK|TOUCH|DONE)\b/;
const LEADING_SPACE_RE = /^\s+/;
const NON_SPACE_RE = /\S/;
const TRAILING_NEWLINE_RE = /\n$/;

/** The lines after the title and one blank line, up to the next blank line or `## `. */
function cardBlock(body: string): string[] {
  const lines = body.replace(LEADING_SPACE_RE, "").split("\n");
  const block: string[] = [];

  if (lines[1] !== "") return block;

  for (const line of lines.slice(CARD_START)) {
    if (line.trim() === "" || line.startsWith("## ")) break;
    block.push(line);
  }

  return block;
}

/** Errors for card line `i` (0-based) against its label. */
function cardLineErrors(label: string, i: number, line: string): string[] {
  const n = i + 1;
  const pad = label.padEnd(CARD_PAD);
  const errors: string[] = [];

  if (!new RegExp(`^${label}\\b`).test(line)) errors.push(`card line ${n} must start with ${label}`);
  else if (!line.startsWith(pad) || !NON_SPACE_RE.test(line.charAt(CARD_PAD)))
    errors.push(`card line ${n} (${label}) needs its text at column ${CARD_PAD + 1}: "${pad}<text>"`);

  const length = Array.from(line).length;

  if (length > CARD_WIDTH) errors.push(`card line ${n} (${label}) is ${length} characters; the limit is ${CARD_WIDTH}`);

  return errors;
}

/**
 * The card a person reads first: the 5 lines after the `# ` title and one blank line, labels in
 * order padded to 7 columns, each line at most 120 characters. One message per failing line.
 */
export function cardErrors(body: string): string[] {
  const block = cardBlock(body);

  if (!block.some((l) => CARD_LABEL_RE.test(l)))
    return [`start with the 5-line card after the title: ${CARD_LABELS.join(", ")}`];

  const errors = CARD_LABELS.flatMap((label, i) => cardLineErrors(label, i, block[i] ?? ""));

  if (block.length > CARD_LABELS.length) errors.push("the card is 5 lines; end it with a blank line after DONE");

  return errors;
}

const PLAN_LINE_CAP = 100;
const PLAN_CAP_FIX = "split it into a roadmap (/write-roadmap)";

/**
 * Lines above the first `## Previous mistakes` outside a fence, frontmatter included; the whole file
 * when absent. Lines matching `skip` outside a fence are not counted.
 */
function linesAboveMistakes(text: string, skip?: RegExp): number {
  const lines = text.replace(TRAILING_NEWLINE_RE, "").split("\n");
  const { fenced } = fencedLineSet(lines);
  const found = lines.findIndex((l, i) => !fenced.has(i) && l === `## ${MISTAKES_H2}`);
  const above = found === NOT_FOUND ? lines.length : found;

  if (skip === undefined) return above;

  return lines.slice(0, above).filter((l, i) => fenced.has(i) || !skip.test(l)).length;
}

/**
 * A file past `cap` lines above Previous mistakes is denied with `fix`; a plan's cap is 100. A fresh
 * save is held to the cap; an update only when it grows past both the cap and the saved file, so
 * legacy files stay editable.
 */
export function capErrors(
  text: string,
  {
    fresh,
    previous,
    cap = PLAN_LINE_CAP,
    fix = PLAN_CAP_FIX,
    skip,
  }: { fresh: boolean; previous?: string | null | undefined; cap?: number; fix?: string; skip?: RegExp },
): string[] {
  const n = linesAboveMistakes(text, skip);
  const ceiling = fresh || previous == null ? cap : Math.max(cap, linesAboveMistakes(previous, skip));

  return n > ceiling ? [`${n} lines above ## ${MISTAKES_H2}, the cap is ${cap}; ${fix}`] : [];
}
