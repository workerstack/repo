/**
 * Reads of a copied AGENTS.md that the migration needs: the text outside the old sentinel block and the sections a
 * stock text lacks.
 */

const SENTINEL_BEGIN = "<!-- repo:begin -->";

/** The start of a line, then the indent a marker may carry. */
const LINE_START = "(?:^|(?<=\\n)|(?<=\\r\\n))[ \\t]*";

/** The trailing space after a marker and the newline that ends its line. */
const MARKER_END = "[ \\t]*\\r?\\n?";

const MANAGED_REGION_RE: Readonly<RegExp> = /* @__PURE__ */ new RegExp(
  `${LINE_START}<!-- repo:begin -->${MARKER_END}[\\s\\S]*?${LINE_START}<!-- repo:end -->${MARKER_END}`,
  "g",
);

const ORPHAN_END_RE = /(?:^|\r?\n)[ \t]*<!-- repo:end -->[ \t]*(?=\r?\n|$)|<!-- repo:end -->/g;

/** Every `##` heading line, its title in the one group; only for matchAll. */
const H2_LINES = /^## (.+)$/gm;

/** Every `##` heading start; only for matchAll. */
const H2_STARTS = /^## /gm;

/** The first `##` heading line, its title in the one group. */
const H2_LINE = /^## (.+)$/m;
const TRAILING_NEWLINES = /(?:\n)+$/;

function cloneRe(re: Readonly<RegExp>): RegExp {
  return new RegExp(re.source, re.flags);
}

/**
 * `text` without its `repo:begin`..`repo:end` blocks, an unclosed block to the end, and stray end markers; "" when
 * only blank lines remain.
 */
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
  const incomingTitles = new Set([...incoming.matchAll(H2_LINES)].map((m) => String(m[1]).trim()));
  const text = existing.replaceAll("\r\n", "\n");
  const matches = [...text.matchAll(H2_STARTS)];
  const chunks: string[] = [];

  for (const [i, match] of matches.entries()) {
    const start = match.index;
    const end = matches[i + 1]?.index ?? text.length;
    const block = text.slice(start, end).replace(TRAILING_NEWLINES, "");
    const title = block.match(H2_LINE)?.[1]?.trim();

    if (title !== undefined && title !== "" && !incomingTitles.has(title)) chunks.push(block);
  }

  return chunks.join("\n\n");
}
