/**
 * `AGENTS.md` as a shared file: sync owns the hashed `repo:rules` region at its top, the user owns every other line.
 * Text an older sync or a copied install left there that the user never wrote counts as none of theirs.
 */
import { ALWAYS_ON_BUDGET_KIB, AGENTS_FILE, KIB, KIB_DECIMALS, RULES_REGION } from "./agents-file.constants.ts";
import { extractUserMarkdown } from "./agents-text.ts";
import { hasOwnedHeader } from "./header.ts";
import type { Output } from "./outputs.ts";
import { syntaxOf, writeRegions } from "./region.ts";
import { hashText, type StockHistory } from "./stock-history.ts";

/** What `agentsFile` reads beside the rendered body: the file's text on disk (null when missing) and the stock history table. */
export type AgentsDisk = { text: string | null; history: StockHistory };

/** Whether the root-relative `rel` is the root or a package `AGENTS.md`. */
export function isAgentsFile(rel: string): boolean {
  return rel === AGENTS_FILE || rel.endsWith(`/${AGENTS_FILE}`);
}

/**
 * The tracked block output at `rel`: `body` in the hashed `repo:rules` region at the top of the file on disk, the
 * user's text above and below kept. A root file past the always-on budget gets a warning among its repairs.
 */
export function agentsFile(rel: string, body: string, disk: AgentsDisk): Output {
  const region = { body, name: RULES_REGION, place: "top" } as const;
  const { text, repairs } = writeRegions(userText(rel, disk), syntaxOf(rel), [region]);
  const all = [...repairs, ...budgetRepairs(rel, text)];
  const output: Output = { content: text, kind: "file", managed: "block", path: rel, tracked: true };
  return all.length === 0 ? output : { ...output, repairs: all };
}

/**
 * The user's text in the file on disk: none in a whole file an older sync generated (it carries the owned header) or
 * in an unedited stock copy the history table holds under `rel`; elsewhere the text without the old `repo:begin` blocks.
 */
export function userText(rel: string, { text, history }: AgentsDisk): string {
  if (text === null || hasOwnedHeader(text)) return "";
  if (history[rel]?.includes(hashText(text)) === true) return "";
  return extractUserMarkdown(text);
}

/** The budget warning for the root file's whole `text`, which every session reads; none for a package file. */
function budgetRepairs(rel: string, text: string): string[] {
  const kib = Buffer.byteLength(text) / KIB;
  if (rel !== AGENTS_FILE || kib <= ALWAYS_ON_BUDGET_KIB) return [];
  const size = kib.toFixed(KIB_DECIMALS);
  return [
    `always-on text is ${size} KiB, over the ${ALWAYS_ON_BUDGET_KIB} KiB budget; move some to a path rule or a skill`,
  ];
}
