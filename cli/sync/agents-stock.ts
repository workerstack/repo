/**
 * The stock text an older install left in a marker-less `AGENTS.md`: a run of whole lines that hashes to a stock
 * version, so the user's lines around it can stay while the region takes its place.
 */
import { createHash, type Hash } from "node:crypto";

/** How many hex digits of the sha256 a stock history hash keeps. */
const STOCK_HASH_LENGTH = 16;
const CR = "\r";

/** The rows `at` up to `end` (exclusive) of a file. */
export type StockBlock = { at: number; end: number };

/**
 * The longest run of `rows` (the earliest on a tie) whose LF-joined text, with or without its last newline, has one of
 * `hashes`; null when none does or the run holds only blank lines. A CR ending a row is ignored, and blank rows at the
 * end of the run stay out of it, as the user's spacing.
 */
export function stockBlock(rows: readonly string[], hashes: readonly string[]): StockBlock | null {
  const wanted = new Set(hashes);
  const lines = rows.map((row) => (row.endsWith(CR) ? row.slice(0, row.length - CR.length) : row));
  let best: StockBlock | null = null;
  if (wanted.size === 0) return best;
  for (const [at, first] of lines.entries()) {
    const hash = createHash("sha256").update(first);
    for (const [index, line] of [first, ...lines.slice(at + 1)].entries()) {
      if (index > 0) hash.update(`\n${line}`);
      const found = matches(hash, wanted) ? trimmed(lines, at, at + index + 1) : null;
      if (found !== null && (best === null || found.end - found.at > best.end - best.at)) best = found;
    }
  }
  return best;
}

/** Whether the text `hash` has read so far, or that text and a newline, hashes to one of `wanted`. */
function matches(hash: Hash, wanted: ReadonlySet<string>): boolean {
  return wanted.has(short(hash.copy())) || wanted.has(short(hash.copy().update("\n")));
}

function short(hash: Hash): string {
  return hash.digest("hex").slice(0, STOCK_HASH_LENGTH);
}

/** The run `at` to `end` without its blank rows at the end; null when no row of it is left. */
function trimmed(lines: readonly string[], at: number, end: number): StockBlock | null {
  const kept = lines.slice(at, end);
  while (kept.length > 0 && kept[kept.length - 1]?.trim() === "") kept.pop();
  return kept.length === 0 ? null : { at, end: at + kept.length };
}
