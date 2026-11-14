// The Stop reason a Claude session gets: the picker line, the picker's JSON, then the typed block.
import type { Approvable } from "../strategy.types.ts";
import { pickerInput } from "../approval-picker.ts";
import { closing } from "./orchestrate-kit.ts";

export const PICKER_LINE =
  "call AskUserQuestion with exactly this input, then act on the answer; with no AskUserQuestion tool, end with this block:";

/** The Stop reason that asks a Claude session outside away to approve `items`. */
export function askReason(...items: Approvable[]): string {
  return `${PICKER_LINE}\n${JSON.stringify(pickerInput(items))}\n${closing(...items)}`;
}

/** The picker for `items` after the person chose `pick`, answers keyed by question text as Claude Code sends them back. */
export function clicked(items: Approvable[], pick: { approval?: string; strategy?: string }) {
  const input = pickerInput(items);
  const [approval, strategy] = input.questions;
  const answers: Record<string, string> = {};

  if (approval !== undefined && pick.approval !== undefined) answers[approval.question] = pick.approval;
  if (strategy !== undefined && pick.strategy !== undefined) answers[strategy.question] = pick.strategy;

  return { ...input, answers };
}
