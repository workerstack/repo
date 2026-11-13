/** An `h` reply's handoff: one handoff file for the whole queue the approval block named. */
import path from "node:path";

import type { HookInput } from "./hook-input.ts";
import { itemKey, queueText } from "./orchestrate-reviews.ts";
import { sessionIdOf } from "./orchestrate-session.ts";
import { ITEM_KINDS } from "./orchestrate.constants.ts";
import type { ApprovalItem, HandoffEntry } from "./orchestrate.types.ts";
import { persistHandoff } from "./persist-handoff.ts";

function handoffLeaf(i: ApprovalItem): string {
  const spec = ITEM_KINDS[i.kind];

  return `${spec.prefix}${spec.command} ${i.serial}`;
}

function stateLine(q: HandoffEntry): string {
  const strategy = q.strategy === null ? "" : ` (strategy: ${q.strategy})`;

  return `- ${itemKey(q.item)}: ${q.item.path}${strategy}`;
}

function shownEntry(q: HandoffEntry): string {
  const strategy = q.strategy === null ? "" : ` (strategy ${q.strategy}${q.written ? " written" : ""})`;

  return `${itemKey(q.item)}${strategy}`;
}

// One handoff for the whole queue line, in its order; Watch-outs stay empty because the files carry their own.
function handoffBody(sid: string, queue: HandoffEntry[]): string {
  const name = `run ${queue.map((q) => itemKey(q.item)).join(" then ")}`;

  return [
    `HANDOFF_NAME: ${name}`,
    "",
    `# ${name}`,
    "",
    "## Goal",
    `Run ${queueText(queue.map((q) => q.item))} in a fresh session.`,
    "",
    "## State",
    ...queue.map(stateLine),
    "",
    "## Context",
    `- handed off by an h reply in session ${sid}`,
    "",
    "## Next",
    "1 [ ] Run the queue in order",
    ...queue.map((q, k) => `1.${k + 1} [ ] ${handoffLeaf(q.item)}`),
    "",
    "## Watch-outs",
    "(none)",
    "",
  ].join("\n");
}

/** Writes the handoff and tells the agent where; or why it could not be written. */
export function orchestrateHandoff(data: HookInput, ws: string, queue: HandoffEntry[]): string {
  const shown = queue.map(shownEntry).join(", then ");

  const result = persistHandoff({ content: handoffBody(sessionIdOf(data), queue), workspaceRoot: ws });

  if (!result.ok) {
    const items = queueText(queue.map((q) => q.item));

    return `h did not hand off ${items}: the handoff could not be written (${result.error})`;
  }

  const abs = path.resolve(ws, result.path);

  return (
    `h handed off ${shown} to ${abs}; ` +
    `tell the person to run /pickup ${result.serial} in a fresh session, and do no work here`
  );
}
