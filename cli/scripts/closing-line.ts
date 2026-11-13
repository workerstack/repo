import { osaDistance } from "./osa-distance.ts";
import {
  ACTION_WORDS,
  BLOCK_FENCE,
  BLOCK_ROWS,
  CODE_NEAR_MISS_RE,
  EXACT_REPLIES,
  FAST_BLOCK_ROWS,
  FAST_PLAN,
  HANDOFF_LETTER,
  HEADER_ITEM_RE,
  HEADER_SEP,
  IMPLEMENT_LETTERS,
  INFER_MAX_DISTANCE,
  INFER_MIN_LENGTH,
  ITEM_SEP,
  LINE_BREAK_RE,
  LINE_END_WS_RE,
  NOT_FOUND,
  MAX_ACTION_WORDS,
  MAX_REPLY_WORDS,
  MAX_STRATEGY_WORDS,
  PLAN,
  ROADMAP,
  STRATEGY_WORDS,
  TRAILING_PUNCT_RE,
  WORD_SEP_RE,
} from "./strategy.constants.ts";
/**
 * The approval block: the fenced block that asks for approval or a handoff, rendered and parsed here and nowhere
 * else; and what a reply to it means.
 */
import { parseStrategy } from "./strategy.ts";
import type { Approval, ApprovalAction, Approvable } from "./strategy.types.ts";

/** True when no item has a strategy, so the block has no codes to offer. */
function allFast(items: Approvable[]): boolean {
  return items.every((i) => i.kind === FAST_PLAN);
}

function headerOf(i: Approvable): string {
  return i.kind === FAST_PLAN ? `${i.kind} ${i.serial}` : `${i.kind} ${i.serial}${HEADER_SEP}${i.strategy}`;
}

/**
 * The only renderer of the approval block: a fenced header naming each item and its strategy (a fast plan has none),
 * then fixed rows for implement and hand off, with their codes unless every item is a fast plan.
 */
export function closingBlock(items: Approvable[]): string {
  if (items.length === 0) throw new Error("closingBlock needs at least one item");
  const rows = allFast(items) ? FAST_BLOCK_ROWS : BLOCK_ROWS;

  return [BLOCK_FENCE, items.map(headerOf).join(ITEM_SEP), ...rows, BLOCK_FENCE].join("\n");
}

function headerItem(part: string): Approvable | null {
  const m = HEADER_ITEM_RE.exec(part);

  if (m === null) return null;

  const [, kind, serial, word] = m;

  if (kind === FAST_PLAN) return word === undefined ? { kind, serial: Number(serial) } : null;
  const strategy = parseStrategy(String(word));

  if ((kind !== PLAN && kind !== ROADMAP) || strategy === null) return null;

  return { kind, serial: Number(serial), strategy };
}

/**
 * The items of the message's last fenced block, or null unless that block ends the message and is exactly what
 * `closingBlock` renders for them. Prose before it and whitespace at line ends are ignored.
 */
export function parseClosingBlock(msg: string): Approvable[] | null {
  const lines = msg
    .trimEnd()
    .split(LINE_BREAK_RE)
    .map((l) => l.replace(LINE_END_WS_RE, ""));

  const end = lines.length - 1;
  const start = lines.lastIndexOf(BLOCK_FENCE, end - 1);

  if (lines[end] !== BLOCK_FENCE || start === NOT_FOUND) return null;

  const items: Approvable[] = [];

  const header = String(lines[start + 1]);

  for (const part of header.split(ITEM_SEP)) {
    const item = headerItem(part);

    if (item === null) return null;
    items.push(item);
  }

  return closingBlock(items) === lines.slice(start).join("\n") ? items : null;
}

/** Every distinct value whose word is `phrase`, or else within the inference distance of it. */
function matches<T>(phrase: string, words: readonly (readonly [string, T])[]): T[] {
  const exact = words.find(([w]) => w === phrase);

  if (exact !== undefined) return [exact[1]];

  if (phrase.length < INFER_MIN_LENGTH) return [];

  return [...new Set(words.filter(([w]) => osaDistance(phrase, w) <= INFER_MAX_DISTANCE).map(([, v]) => v))];
}

function actionOf(words: string[]): { kind: ApprovalAction; used: number } | null {
  const first = String(words[0]);

  if (first === HANDOFF_LETTER) return { kind: "handoff", used: 1 };

  if (IMPLEMENT_LETTERS.includes(first)) return { kind: "approve", used: 1 };

  for (let used = 1; used <= MAX_ACTION_WORDS; used++) {
    const [kind, ...more] = matches(words.slice(0, used).join(" "), ACTION_WORDS);

    if (kind !== undefined && more.length === 0) return { kind, used };
  }

  return null;
}

/**
 * What a reply means: a short yes, `h`, or a code, exactly; else an action (`i`, `y`, `h`, or `implement` /
 * `hand off` inferred) with optional strategy words, inferred when misspelled. Null for a revision; `unknown`
 * (carrying the whole reply) for a near-miss code or a strategy word close to several.
 */
export function parseApproval(prompt: string): Approval | null {
  const whole = prompt.trim();
  const words = whole.toLowerCase().replace(TRAILING_PUNCT_RE, "").trim().split(WORD_SEP_RE);
  const text = words.join(" ");
  const exact = EXACT_REPLIES.get(text);

  if (exact !== undefined) return { ...exact };

  if (words.length > MAX_REPLY_WORDS) return null;

  if (words.length === 1 && CODE_NEAR_MISS_RE.test(text)) return { kind: "unknown", word: whole };

  const action = actionOf(words);

  if (action === null) return null;
  const rest = words.slice(action.used);

  if (rest.length === 0) return { kind: action.kind, strategy: null };

  const [strategy, ...more] = rest.length > MAX_STRATEGY_WORDS ? [] : matches(rest.join("-"), STRATEGY_WORDS);

  if (strategy === undefined) return null;

  return more.length === 0 ? { kind: action.kind, strategy } : { kind: "unknown", word: whole };
}

/**
 * What a reply means to the block it answers. A block of only fast plans offers no codes, so a code or a strategy
 * word is `unknown` there; a bare `i` or `h` stands.
 */
export function approvalFor(prompt: string, items: Approvable[]): Approval | null {
  const reply = parseApproval(prompt);

  if (reply === null || reply.kind === "unknown" || reply.strategy === null || !allFast(items)) return reply;

  return { kind: "unknown", word: prompt.trim() };
}
