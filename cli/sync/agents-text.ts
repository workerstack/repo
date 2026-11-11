/** Reads of a copied AGENTS.md that the migration needs: the text outside the old sentinel block and the sections a stock text lacks. */

const SENTINEL_BEGIN = "<!-- repo:begin -->";
const MANAGED_REGION_RE =
  /(?:^|(?<=\n)|(?<=\r\n))[ \t]*<!-- repo:begin -->[ \t]*\r?\n?[\s\S]*?(?:^|(?<=\n)|(?<=\r\n))[ \t]*<!-- repo:end -->[ \t]*\r?\n?/g;
const ORPHAN_END_RE = /(?:^|\r?\n)[ \t]*<!-- repo:end -->[ \t]*(?=\r?\n|$)|<!-- repo:end -->/g;

const cloneRe = (re: RegExp): RegExp => new RegExp(re.source, re.flags);

/** `text` without its `repo:begin`..`repo:end` blocks, an unclosed block to the end, and stray end markers; "" when only blank lines remain. */
export function extractUserMarkdown(text: string): string {
  let user = text.replace(cloneRe(MANAGED_REGION_RE), "");
  const i = user.indexOf(SENTINEL_BEGIN);
  if (i >= 0) user = user.slice(0, i);
  user = user.replace(cloneRe(ORPHAN_END_RE), "");
  return user.replaceAll("\r\n", "\n").replaceAll("\n", "") === "" ? "" : user;
}

/** `##` blocks in `existing` whose titles are not in `incoming`. */
export function extraH2Sections(existing: string, incoming: string): string {
  // The pattern has one group and it always takes part in a match.
  const incomingTitles = new Set([...incoming.matchAll(/^## (.+)$/gm)].map((m) => m[1]!.trim()));
  const text = existing.replaceAll("\r\n", "\n");
  const matches = [...text.matchAll(/^## /gm)];
  if (!matches.length) return "";
  const chunks: string[] = [];
  for (let i = 0; i < matches.length; i++) {
    // matchAll results always carry an index, and i is within matches.
    const start = matches[i]!.index;
    const end = i + 1 < matches.length ? matches[i + 1]!.index : text.length;
    const block = text.slice(start, end).replace(/(?:\n)+$/, "");
    const title = block.match(/^## (.+)$/m)?.[1]?.trim();
    if (title && !incomingTitles.has(title)) chunks.push(block);
  }
  return chunks.join("\n\n");
}
