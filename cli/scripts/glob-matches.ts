/** The names a pattern matches on disk from a dir, as bash writes them. The one place the bash walk reads the disk. */
import fs from "node:fs";
import type path from "node:path";

import { type GlobToken, isLitToken, isMatchToken, type MatchToken, regExpOf } from "./shell-glob.ts";
import { LAST } from "./shell.constants.ts";

/** The most dir entries one pattern may read; past it the gate cannot read the pattern. */
const MAX_GLOB_ENTRIES = 20_000;

/** A pattern's segments between slashes; it always has one. */
type Segments = [MatchToken[], ...MatchToken[][]];

/** A search in progress: the segments it walks, the path module, and the dir entries read so far. */
type Search = { segments: Segments; p: typeof path; read: number };

/**
 * A place a search reached: the path as bash writes it, with a trailing `/` or empty at a relative start, and as the
 * disk reads it.
 */
type Place = { typed: string; real: string };

/** `tokens` split at each `/` of their text, which bash never matches with a pattern. */
function segmentsOf(tokens: readonly MatchToken[]): Segments {
  const segments: Segments = [[]];

  for (const t of tokens) {
    const pieces = t.kind === "lit" ? t.bash.split("/") : [null];

    for (const [k, piece] of pieces.entries()) {
      if (k > 0) segments.push([]);

      if (piece === null) segments.at(LAST)?.push(t);
      else if (piece !== "") segments.at(LAST)?.push({ bash: piece, kind: "lit", text: piece });
    }
  }

  return segments;
}

/** The names in `dir`, counted against the search; none when it is no dir. */
function namesIn(dir: string, search: Search): string[] {
  try {
    const names = fs.readdirSync(dir);
    search.read += names.length;

    return names;
  } catch {
    return [];
  }
}

function isDir(real: string): boolean {
  return fs.statSync(real, { throwIfNoEntry: false })?.isDirectory() === true;
}

/** The text of a segment that holds no pattern, else null. */
function literalOf(seg: readonly MatchToken[]): string | null {
  return seg.every(isLitToken) ? seg.map((t) => t.bash).join("") : null;
}

/** `at` one step down into `name`. */
function down(at: Place, name: string, p: typeof path): Place {
  return { real: p.join(at.real, name), typed: `${at.typed}${name}/` };
}

/** The names one segment reaches in `at`: its text when it holds no pattern, else the sorted names it matches. */
function namesFor(seg: readonly MatchToken[], at: Place, search: Search): string[] {
  const lit = literalOf(seg);

  if (lit !== null) return [lit];
  const re = regExpOf(seg);

  return namesIn(at.real, search)
    .filter((n) => re.test(n))
    .toSorted();
}

/**
 * Each typed path the segments from `k` reach from `at` that exists; a trailing `/` keeps only dirs; null past the
 * cap.
 */
function walk(k: number, at: Place, search: Search): string[] | null {
  const { segments } = search;
  const seg = segments[k];

  if (seg === undefined) return fs.existsSync(at.real) ? [at.typed.slice(0, LAST)] : [];

  if (seg.length === 0 && k === segments.length - 1) return isDir(at.real) ? [at.typed] : [];
  const names = namesFor(seg, at, search);

  if (search.read > MAX_GLOB_ENTRIES) return null;
  const found: string[] = [];

  for (const name of names) {
    const more = walk(k + 1, down(at, name, search.p), search);

    if (more === null) return null;
    found.push(...more);
  }

  return found;
}

/** Where a search starts: the dir, or the root or drive a pattern's literal first segment names. */
function startOf(segments: Segments, dir: string, p: typeof path): { at: Place; from: number } {
  const head = literalOf(segments[0]);

  return head !== null && segments.length > 1 && p.isAbsolute(`${head}/`)
    ? { at: { real: `${head}/`, typed: `${head}/` }, from: 1 }
    : { at: { real: dir, typed: "" }, from: 0 };
}

/**
 * The paths `tokens` match from `dir`, as bash writes them: sorted, a leading `.` typed, the typed text before the
 * first pattern kept. An empty list when none match, which leaves the word as typed; null when a part is unknown or
 * the search reads more than 20,000 entries, which the gate cannot read.
 */
export function globMatches(tokens: readonly GlobToken[], dir: string, p: typeof path): string[] | null {
  const known = tokens.filter(isMatchToken);

  if (known.length < tokens.length) return null;
  const segments = segmentsOf(known);
  const { at, from } = startOf(segments, dir, p);

  return walk(from, at, { p, read: 0, segments });
}
