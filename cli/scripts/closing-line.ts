import { ITEM_KIND_LIST } from "./orchestrate.constants.ts";
import { osaDistance } from "./osa-distance.ts";
import {
  ACTION_WORDS,
  ADVICE_ROW_RE,
  AFTER_HEADER,
  BLOCK_FENCE,
  BLOCK_ROWS,
  CODE_NEAR_MISS_RE,
  EXACT_REPLIES,
  HANDOFF_LETTER,
  HEADER_AT,
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
  NOT_A_CHOICE,
  STRATEGY_WORDS,
  TRAILING_PUNCT_RE,
  WORD_SEP_RE,
} from "./strategy.constants.ts";
/**
 * The approval block: the fenced block that asks for approval or a handoff, rendered and parsed here and nowhere
 * else; and what a reply to it means.
 */
import { parseStrategy } from "./strategy.ts";
import type { ApprovalReply, ApprovalAction, Approvable } from "./strategy.types.ts";

function adviceRow(i: Approvable): string[] {
  return i.advice === null ? [] : [`  ${i.kind} ${i.serial} advice: ${i.advice}`];
}

function headerOf(i: Approvable): string {
  return `${i.kind} ${i.serial}${HEADER_SEP}${i.strategy}`;
}

/** The block's header line: each item with its strategy, joined in run order. */
export function closingHeader(items: Approvable[]): string {
  return items.map(headerOf).join(ITEM_SEP);
}

/**
 * The only renderer of the approval block: a fenced header naming each item and its strategy, an advice row for each
 * item that has advice, then fixed rows for implement and hand off with their strategy words.
 */
export function closingBlock(items: Approvable[]): string {
  if (items.length === 0) throw new Error("closingBlock needs at least one item");

  return [BLOCK_FENCE, closingHeader(items), ...items.flatMap(adviceRow), ...BLOCK_ROWS, BLOCK_FENCE].join("\n");
}

function headerItem(part: string): Approvable | null {
  const m = HEADER_ITEM_RE.exec(part);

  if (m === null) return null;

  const [, word, serial, strategyWord] = m;
  const kind = ITEM_KIND_LIST.find((k) => k === word);
  const strategy = parseStrategy(strategyWord);

  if (kind === undefined || strategy === null) return null;

  return { advice: null, kind, serial: Number(serial), strategy };
}

/** The items a header line names, with no advice; null when any part is no item. */
export function parseClosingHeader(header: string): Approvable[] | null {
  const items: Approvable[] = [];

  for (const part of header.split(ITEM_SEP)) {
    const item = headerItem(part);

    if (item === null) return null;
    items.push(item);
  }

  return items;
}

/** Sets each advice row's text on the full item it names; any other row is left for the re-render match to refuse. */
function fillAdvice(items: Approvable[], rows: string[]): void {
  for (const row of rows) {
    const [, kind, serial, text] = ADVICE_ROW_RE.exec(row) ?? [];
    const item = items.find((i) => i.kind === kind && i.serial === Number(serial));

    if (item !== undefined) item.advice = String(text);
  }
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

  const items = parseClosingHeader(String(lines[start + HEADER_AT]));

  if (items === null) return null;

  fillAdvice(items, lines.slice(start + AFTER_HEADER, end));

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
 * What a reply means: a short yes or `h`, exactly; else an action (`i`, `y`, `h`, or `implement` /
 * `hand off` inferred) with optional strategy words, inferred when misspelled. Null for a revision; `unknown`
 * (carrying the whole reply) for a retired letter code, a near-miss of one, or a strategy word close to several.
 */
export function parseApprovalReply(prompt: string): ApprovalReply | null {
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

/** The line that brings the block back for a reply that is no choice: the words it offers, then the block again. */
export function notAChoice(reply: string, items: Approvable[]): string {
  return `"${reply}" is not a choice; ${NOT_A_CHOICE}; end with this block again:\n${closingBlock(items)}`;
}
