import { HTML_OPEN } from "./header.constants.ts";
import {
  CODE_FENCE,
  HASH_LENGTH,
  HASH_MARKER,
  HTML_MARKER,
  LEGACY_CLOSE,
  LEGACY_NAME,
  LEGACY_OPEN,
} from "./region.constants.ts";
import type { RegionSyntax } from "./region.ts";

/** One marker line: where it is, the region it names, and the hash an open carries. */
export type Marker = { at: number; name: string; close: boolean; hash: string | null; legacy: boolean; line: string };
export type Pair = readonly [Marker, Marker];
export type Found = { pairs: Pair[]; opens: Marker[]; closes: Marker[] };
/** A file's lines, its syntax and the region name its legacy pair converts to. */
export type Doc = { rows: string[]; syntax: RegionSyntax; legacy: string };
/** A marker match: the line, the slash of a close, the name, the hash. */
type Groups = RegExpExecArray & [string, string | undefined, string, string | undefined];
/** A fence match: the line, the run of backticks or tildes, the rest of the line. */
type FenceGroups = RegExpExecArray & [string, string, string];

/**
 * Every marker line of `doc`, the legacy pair named for the region it converts to. In markdown a line inside a
 * fenced code block is never a marker, so a doc can show the form.
 */
export function scan(doc: Doc): Marker[] {
  const skip = doc.syntax === HTML_OPEN ? fenced(doc.rows) : new Set<number>();
  const found: Marker[] = [];
  for (const [at, row] of doc.rows.entries()) {
    const marker = skip.has(at) ? null : parse(row.trimEnd(), doc.syntax);
    if (marker !== null) found.push({ ...marker, at, name: marker.legacy ? doc.legacy : marker.name });
  }
  return found;
}

/** Whether sync wrote `mark`: the legacy pair, or an open with a full hash; any other may be the user's own text. */
export function isOurs(mark: Marker): boolean {
  return mark.legacy || mark.hash?.length === HASH_LENGTH;
}

/**
 * Pairs each open with the next close; an open before another open, a close with no open and a last open are
 * strays.
 */
export function pairUp(marks: readonly Marker[]): Found {
  const found: Found = { closes: [], opens: [], pairs: [] };
  let open: Marker | null = null;
  for (const mark of marks) {
    if (!mark.close) {
      if (open !== null) found.opens.push(open);
      open = mark;
    } else if (open === null) {
      found.closes.push(mark);
    } else {
      found.pairs.push([open, mark]);
      open = null;
    }
  }
  if (open !== null) found.opens.push(open);
  return found;
}

function parse(line: string, syntax: RegionSyntax): Omit<Marker, "at"> | null {
  const match = (syntax === HTML_OPEN ? HTML_MARKER : HASH_MARKER).exec(line);
  if (match !== null) {
    const [, slash, name, hash] = match /* the name group always takes part */ as Groups;
    const isClose = slash !== undefined;
    return { close: isClose, hash: hash?.toLowerCase() ?? null, legacy: false, line, name: name.toLowerCase() };
  }
  const isClose = syntax !== HTML_OPEN && LEGACY_CLOSE.test(line);
  if (!isClose && (syntax === HTML_OPEN || !LEGACY_OPEN.test(line))) return null;
  return { close: isClose, hash: null, legacy: true, line, name: LEGACY_NAME };
}

/**
 * The rows of each closed fenced code block, fence lines included, per CommonMark: a run of 3 or more backticks or
 * tildes indented up to 3 spaces opens (a backtick run with a backtick after it does not), and a run of the same
 * character at least as long with nothing after it closes. A fence no line closes is not one here, so a region
 * sync writes below it still reads back.
 */
function fenced(rows: readonly string[]): Set<number> {
  const inside = new Set<number>();
  let start: number | null = null;
  let fence = "";
  for (const [at, row] of rows.entries()) {
    const match = CODE_FENCE.exec(row);
    if (match === null) continue;
    const [, run, rest] = match /* both groups always take part */ as FenceGroups;
    if (start === null) {
      if (run.startsWith("`") && rest.includes("`")) continue;
      [start, fence] = [at, run];
    } else if (run.startsWith(fence.charAt(0)) && run.length >= fence.length && rest.trim() === "") {
      for (let line = start; line <= at; line += 1) inside.add(line);
      start = null;
    }
  }
  return inside;
}
