import {
  APPROVAL_RE,
  CLOSING_RE,
  DEEP,
  FAST,
  HANDOFF_LETTER,
  HANDOFFS,
  ITEM_RE,
  ITEM_SEP,
  LEAD_MARKS_RE,
  PLAN,
  REVIEW_DEEP,
  REVIEW_FAST,
  ROADMAP,
  STRATEGIES,
  TRAIL_MARKS_RE,
} from "./strategy.constants.ts";
/**
 * The closing line: the one line that asks for approval or a handoff, rendered and parsed here and nowhere else;
 * and what a reply `y`, `y <strategy>`, `h`, `h fast` or `h deep` means.
 */
import { parseStrategy } from "./strategy.ts";
import type { Approval, Approvable, Strategy } from "./strategy.types.ts";

function itemText(i: Approvable): string {
  return `${i.kind} ${i.serial} (strategy: ${i.strategy})`;
}

function handoffStrategy(w: string): Strategy | null {
  if (w === FAST) return REVIEW_FAST;

  return w === DEEP ? REVIEW_DEEP : null;
}

/**
 * The only renderer of the approval line. The first `or` list holds every strategy not held by all items;
 * the second offers a handoff to a fresh session.
 */
export function closingLine(items: Approvable[]): string {
  if (items.length === 0) throw new Error("closingLine needs at least one item");
  const others = STRATEGIES.filter((s) => !items.every((i) => i.strategy === s));
  const run = items.map(itemText).join(ITEM_SEP);

  return `Reply "y" to run ${run}, or ${others.map((s) => `"y ${s}"`).join(" / ")}, or ${HANDOFFS}.`;
}

function itemOf(part: string): Approvable | null {
  const it = ITEM_RE.exec(part) /* CLOSING_RE matched, so every part is an item */ as RegExpExecArray;

  const [, kind, serial, word] = [...it] /* all three groups match whenever the pattern does */ as [
    string,
    string,
    string,
    string,
  ];

  const strategy = parseStrategy(word);

  if ((kind !== PLAN && kind !== ROADMAP) || strategy === null) return null;

  return { kind, serial: Number(serial), strategy };
}

/**
 * The items a closing line names, or null unless the line is exactly what `closingLine` renders for them.
 * Markdown around the line (bold, backticks, a quote marker) is ignored.
 */
export function parseClosingLine(line: string): Approvable[] | null {
  const text = line.replace(LEAD_MARKS_RE, "").replace(TRAIL_MARKS_RE, "");
  const m = CLOSING_RE.exec(text);

  if (m === null) return null;
  const items: Approvable[] = [];

  for (const part of (m[1] /* group 1 is not optional in CLOSING_RE */ as string).split(ITEM_SEP)) {
    const item = itemOf(part);

    if (item === null) return null;
    items.push(item);
  }

  return closingLine(items) === text ? items : null;
}

/**
 * A reply of `y` (keep each file's strategy) or `y <strategy>`, or a handoff `h` (keep) or `h fast` / `h deep`.
 * Null when the prompt is neither a y nor an h reply.
 */
export function parseApproval(prompt: string): Approval | null {
  const m = APPROVAL_RE.exec(prompt.trim());

  if (m === null) return null;
  const [, letter, word] = m;
  const kind = letter?.toLowerCase() === HANDOFF_LETTER ? "handoff" : "approve";

  if (word === undefined) return { kind, strategy: null };
  const strategy = kind === "handoff" ? handoffStrategy(word.toLowerCase()) : parseStrategy(word.toLowerCase());

  return strategy === null ? { kind: "unknown", word } : { kind, strategy };
}
