/**
 * `AGENTS.md` as a shared file: sync owns the hashed `repo:rules` region, the user owns every other line. Text an
 * older sync or a copied install left there that the user never wrote counts as none of theirs, and the region takes
 * the place of the stock rules an old file held.
 */
import { ALWAYS_ON_BUDGET_KIB, AGENTS_FILE, KIB, KIB_DECIMALS, RULES_REGION } from "./agents-file.constants.ts";
import { stockBlock } from "./agents-stock.ts";
import { extractUserMarkdown } from "./agents-text.ts";
import { hasOwnedHeader } from "./header.ts";
import type { Output } from "./outputs.ts";
import { hasMarkers, syntaxOf, writePlaced } from "./region.ts";
import { hashText, type StockHistory } from "./stock-history.ts";

/**
 * What `agentsFile` reads beside the rendered body: the file's text on disk (null when missing) and the stock history
 * table.
 */
export type AgentsDisk = { text: string | null; history: StockHistory };

/**
 * The user's text in a file on disk: the lines above and below the stock rules it held, and those rules' own lines
 * with the newline that followed them ("" when it held none).
 */
export type UserText = { above: string; below: string; stock: string };

const REPLACED = `replaced the old stock rules with repo:${RULES_REGION}`;

/** The newline that ends a text's last line. */
const LAST_NEWLINE = /\r?\n$/;
const NO_TEXT: UserText = { above: "", below: "", stock: "" };

/** Whether the root-relative `rel` is the root or a package `AGENTS.md`. */
export function isAgentsFile(rel: string): boolean {
  return rel === AGENTS_FILE || rel.endsWith(`/${AGENTS_FILE}`);
}

/**
 * The tracked block output at `rel`: `body` in the hashed `repo:rules` region where the old stock rules stood, else
 * where its markers are, else at the top; the user's text above and below kept. A root file past the always-on budget
 * gets a warning among its repairs.
 */
export function agentsFile(rel: string, body: string, disk: AgentsDisk): Output {
  const region = { body, name: RULES_REGION, place: "top" } as const;
  const user = userText(rel, disk, body);
  const hasStock = user.stock !== "";
  const at = hasStock ? rowCount(user.above) : undefined;
  const { text, repairs } = writePlaced({ at, text: `${user.above}${user.below}` }, syntaxOf(rel), [region]);
  const all = [...(hasStock ? [REPLACED] : []), ...repairs, ...budgetRepairs(rel, text)];
  const output: Output = { content: text, kind: "file", managed: "block", path: rel, tracked: true };

  return all.length === 0 ? output : { ...output, repairs: all };
}

/**
 * The user's text in the file on disk: none in a whole file an older sync generated (it carries the owned header). In
 * a file with no `repo:rules` marker, the longest run of lines that is an unedited stock text (a version the history
 * table holds under `rel`, or `body` itself) is none of theirs either, and splits the text into the lines above and
 * below it, and is returned as is for a caller that writes the file back before the region replaces it. The lines
 * above and below lose the old `repo:begin` blocks.
 */
export function userText(rel: string, { text, history }: AgentsDisk, body: string): UserText {
  if (text === null || hasOwnedHeader(text)) return NO_TEXT;
  const rows = text.split("\n");
  const hashes = [...(history[rel] ?? []), hashText(body)];
  const block = hasMarkers(text, syntaxOf(rel), RULES_REGION) ? null : stockBlock(rows, hashes);

  if (block === null) return { ...NO_TEXT, below: extractUserMarkdown(text) };
  const above = block.at === 0 ? "" : `${rows.slice(0, block.at).join("\n")}\n`;
  const below = rows.slice(block.end).join("\n");
  const stock = `${rows.slice(block.at, block.end).join("\n")}${block.end < rows.length ? "\n" : ""}`;

  return { above: extractUserMarkdown(above), below: extractUserMarkdown(below), stock };
}

/** How many lines `text` holds, a last line with no newline included. */
function rowCount(text: string): number {
  return text === "" ? 0 : text.replace(LAST_NEWLINE, "").split("\n").length;
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
