/**
 * The approval picker: the AskUserQuestion input Stop asks a Claude session for, rendered from the saved items, and
 * what an answer to it means. The question text carries the typed block's header, so an answer names its items from
 * the sent input alone.
 */
import { z } from "zod";

import { closingHeader, parseClosingHeader } from "./closing-line.ts";
import type { KnownApproval } from "./orchestrate.types.ts";
import {
  ADVICE_BECAUSE_RE,
  ADVICE_NOTE_SEP,
  APPROVAL_ASK,
  APPROVAL_HEADER,
  AS_SAVED_LABEL,
  HANDOFF_LABEL,
  IMPLEMENT_LABEL,
  OPTION_ORDER,
  SAVED_NOTE,
  STRATEGY_HEADER,
  STRATEGY_MEANING,
  STRATEGY_QUESTION,
} from "./strategy.constants.ts";
import { hasStrategy, parseStrategy } from "./strategy.ts";
import type { Approvable, ApprovalAction, Strategy } from "./strategy.types.ts";

function inputSchema() {
  const choice = z.object({ description: z.string(), label: z.string() });

  const asked = z.object({
    header: z.string(),
    multiSelect: z.boolean(),
    options: z.array(choice),
    question: z.string(),
  });

  return z.object({ answers: z.record(z.string(), z.string()).optional(), questions: z.array(asked) });
}

/** An AskUserQuestion tool input as the hook reads it: the questions, and after the click the answers by text. */
export const askInputSchema: z.ZodType<AskInput> = /* @__PURE__ */ inputSchema();

export type AskInput = {
  answers?: Record<string, string> | undefined;
  questions: {
    header: string;
    multiSelect: boolean;
    options: { description: string; label: string }[];
    question: string;
  }[];
};

type Question = AskInput["questions"][number];

type Option = Question["options"][number];

type Strategic = Extract<Approvable, { strategy: Strategy }>;

/** What a click or a typed answer means: a reply on the items the picker named, or revision feedback on them. */
type PickerAnswer = { named: Approvable[]; reply: KnownApproval } | { named: Approvable[]; feedback: string };

const ACTION_LABELS: ReadonlyMap<string, ApprovalAction> = /* @__PURE__ */ new Map([
  [IMPLEMENT_LABEL, "approve"],
  [HANDOFF_LABEL, "handoff"],
]);

// A blank line starts a new key group, so the picker is built, sent and printed in the order Claude Code shows it.
function option(label: string, description: string): Option {
  return {
    label,

    description,
  };
}

/** The advice an item's file holds as the strategy it names and its reason; null for none or another shape. */
function advised(item: Strategic): { strategy: Strategy; reason: string } | null {
  const [, word, reason] = ADVICE_BECAUSE_RE.exec(item.advice ?? "") ?? [];
  const strategy = parseStrategy(word);

  return strategy === null ? null : { reason: String(reason), strategy };
}

/** The advice lines that name `strategy`; each names its item when the queue has several. */
function adviceNotes(items: Strategic[], strategy: Strategy): string[] {
  return items.flatMap((i) => {
    const a = advised(i);
    const who = items.length > 1 ? ` for ${i.kind} ${i.serial}` : "";

    return a?.strategy === strategy ? [`advice${who}: ${a.reason}`] : [];
  });
}

function strategyOption(items: Strategic[], strategy: Strategy, opts: { saved: boolean }): Option {
  const notes = [...(opts.saved ? [SAVED_NOTE] : []), ...adviceNotes(items, strategy)];

  return option(strategy, notes.length === 0 ? STRATEGY_MEANING[strategy] : notes.join(ADVICE_NOTE_SEP));
}

/** The queue's saved values, in order, each once. */
function savedOf(items: Strategic[]): Strategy[] {
  return [...new Set(items.map((i) => i.strategy))];
}

/**
 * The strategy options: the saved value, then the advised ones, then the rest in `OPTION_ORDER`. A queue whose items
 * hold different values leads with `as saved` and the three strategies, four options in all.
 */
function strategyOptions(items: Strategic[]): Option[] {
  const [saved, ...mixed] = savedOf(items);

  if (saved === undefined) return [];

  if (mixed.length > 0) {
    const held = items.map((i) => `${i.kind} ${i.serial} ${i.strategy}`).join(", ");

    return [option(AS_SAVED_LABEL, held), ...OPTION_ORDER.map((s) => strategyOption(items, s, { saved: false }))];
  }

  const advisedValues = items.flatMap((i) => advised(i)?.strategy ?? []);
  const order = [...new Set([saved, ...advisedValues, ...OPTION_ORDER])];

  return order.map((s) => strategyOption(items, s, { saved: s === saved }));
}

function question(header: string, text: string, options: Option[]): Question {
  return {
    question: text,

    header,

    multiSelect: false,

    options,
  };
}

/** The picker for `items`: implement or hand off, and, unless every item is a fast one, which strategy. */
export function pickerInput(items: Approvable[]): AskInput {
  const approval = question(APPROVAL_HEADER, `${closingHeader(items)}${APPROVAL_ASK}`, [
    option(IMPLEMENT_LABEL, "run it in this session"),
    option(HANDOFF_LABEL, "write a handoff to run in a fresh session"),
  ]);

  const options = strategyOptions(items.filter(hasStrategy));

  const strategy = question(STRATEGY_HEADER, STRATEGY_QUESTION, options);

  return { questions: options.length === 0 ? [approval] : [approval, strategy] };
}

/** True when a question asks for approval: the picker's own header, so any other picker is none of ours. */
export function isApprovalPicker(input: AskInput): boolean {
  return input.questions.some((q) => q.header === APPROVAL_HEADER);
}

/** The strategy a click names: null for `as saved` and for the value every named item already holds. */
function pickedStrategy(label: string, named: Approvable[]): Strategy | null {
  const strategy = parseStrategy(label);
  const held = named.filter(hasStrategy);

  return strategy === null || held.every((i) => i.strategy === strategy) ? null : strategy;
}

type Answered = { q: Question; text: string };

/** The question headed `header` with what was answered to it; null when it was not sent or not answered. */
function answerTo(input: AskInput, header: string): Answered | null {
  const q = input.questions.find((c) => c.header === header);
  const text = q === undefined ? undefined : input.answers?.[q.question];

  return q === undefined || text === undefined ? null : { q, text };
}

function isLabel(a: Answered): boolean {
  return a.q.options.some((o) => o.label === a.text);
}

/** The items the approval question's text names, read from its header part as the typed block's header is. */
function namedOf(asked: string): Approvable[] | null {
  return asked.endsWith(APPROVAL_ASK) ? parseClosingHeader(asked.slice(0, -APPROVAL_ASK.length)) : null;
}

/**
 * What the answers mean, read from the sent questions: the items from the approval question's header, the action from
 * its answer and the strategy from the strategy question's. Any answer that is no option's label is feedback. Null when
 * the input is no approval picker, has no answer, or names no items.
 */
export function pickerReply(input: AskInput): PickerAnswer | null {
  const approval = answerTo(input, APPROVAL_HEADER);
  const named = approval === null ? null : namedOf(approval.q.question);

  if (approval === null || named === null) return null;
  const strategy = answerTo(input, STRATEGY_HEADER);
  const [typed] = [approval, strategy].flatMap((a) => (a !== null && !isLabel(a) ? [a.text] : []));

  if (typed !== undefined) return { feedback: typed, named };
  const kind = ACTION_LABELS.get(approval.text);
  const picked = pickedStrategy(strategy?.text ?? "", named);

  return kind === undefined ? null : { named, reply: { kind, strategy: picked } };
}
