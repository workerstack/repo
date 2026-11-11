/** An `h` reply's handoff: one handoff file for the whole queue the closing line named. */
import path from "node:path";
import type { HookInput } from "./hook-input.ts";
import type { ApprovalItem, HandoffEntry } from "./orchestrate.types.ts";
import { itemKey, queueText } from "./orchestrate-reviews.ts";
import { sessionIdOf } from "./orchestrate-session.ts";
import { persistHandoff } from "./persist-handoff.ts";

const handoffLeaf = (i: ApprovalItem): string =>
  i.kind === "plan" ? `/implement-plan ${i.serial}` : `set status locked, then /implement-roadmap ${i.serial}`;

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
    ...queue.map((q) => `- ${itemKey(q.item)}: ${q.item.path} (strategy: ${q.strategy})`),
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
  const shown = queue
    .map((q) => `${itemKey(q.item)} (strategy ${q.strategy}${q.written ? " written" : ""})`)
    .join(", then ");
  const result = persistHandoff({ workspaceRoot: ws, content: handoffBody(sessionIdOf(data), queue) });
  if (!result.ok)
    return `h did not hand off ${queueText(queue.map((q) => q.item))}: the handoff could not be written (${result.error})`;
  const abs = path.resolve(ws, result.path);
  return `h handed off ${shown} to ${abs}; tell the person to run /pickup ${result.serial} in a fresh session, and do no work here`;
}
