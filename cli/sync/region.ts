import { createHash } from "node:crypto";

import { BOM, HTML_CLOSE, HTML_OPEN, OWNED_LOOSE } from "./header.constants.ts";
import { type Doc, type Found, isOurs, type Pair, pairUp, scan } from "./region-scan.ts";
import { FENCE, HASH_LENGTH, LEGACY_NAME, MARKDOWN_EXT } from "./region.constants.ts";

/** The comment syntax of a shared file's markers: `<!--` in markdown, `#` in every other shared file. */
export type RegionSyntax = "#" | typeof HTML_OPEN;

/** One region sync writes into a shared file; `place` is where it goes when the file has no marker for it. */
export type Region = { name: string; body: string; place: "top" | "bottom" };

/** A shared file's new text, LF and exact, and one line per repair sync made to get there. */
export type RegionResult = { text: string; repairs: string[] };

/** A shared file's text and the row a region with no marker goes at instead of its `place`. */
export type PlacedText = { text: string; at: number };

type Step = { rows: string[]; repairs: string[] };

/** A file being written, with the names of the regions a marker line ending in CR belongs to in a file not all CRLF. */
type Shared = Doc & { cr: ReadonlySet<string> };

type Insert = { at: number; block: string[] };

/** A line break, LF or CRLF. */
const LINE_BREAK = /\r?\n/;

/** The first `HASH_LENGTH` hex of the sha256 of `body`, which ends with its last line. */
export function regionHash(body: string): string {
  return createHash("sha256").update(toLines(body).join("\n")).digest("hex").slice(0, HASH_LENGTH);
}

/** The marker syntax of the shared file at `rel`. */
export function syntaxOf(rel: string): RegionSyntax {
  return rel.toLowerCase().endsWith(MARKDOWN_EXT) ? HTML_OPEN : "#";
}

/**
 * `source` with each region written per the repair table, and every other `repo:<name>` region cut. In a `#` file the
 * legacy git pair is the first region's. Markers are read loosely and written exactly; the result is LF. A source
 * given with a row puts a region with no marker at that row, as where the stock text it replaces stood.
 */
export function writeRegions(
  source: string | PlacedText,
  syntax: RegionSyntax,
  regions: readonly Region[],
): RegionResult {
  const { text, at } = typeof source === "string" ? { at: undefined, text: source } : source;
  const [first] = regions;
  const base: Doc = { legacy: first === undefined ? LEGACY_NAME : first.name, rows: toLines(text), syntax };
  const start: Shared = { ...base, cr: crMarked(text, base) };
  let { rows } = start;
  const repairs: string[] = [];

  for (const region of regions) {
    const step = writeOne({ ...start, rows }, region, at);
    rows = step.rows;
    repairs.push(...step.repairs);
  }

  const doc: Shared = { ...start, rows };
  const known = new Set(regions.map((region) => region.name));
  const cut = cutNames(doc, (name) => !known.has(name));

  return { repairs: [...repairs, ...cut.repairs], text: finish(cut.rows) };
}

/** `text` with every region and stray marker cut, legacy pair included; a file with no marker comes back as is. */
export function cutRegions(text: string, syntax: RegionSyntax): RegionResult {
  const cut = cutNames({ legacy: LEGACY_NAME, rows: toLines(text), syntax }, () => true);

  return cut.repairs.length === 0 ? { repairs: [], text } : { repairs: cut.repairs, text: finish(cut.rows) };
}

/**
 * Whether `text` holds any marker line, sync's or one shaped like it, of the region `name` when one is given; a
 * markdown fence holds none.
 */
export function hasMarkers(text: string, syntax: RegionSyntax, name?: string): boolean {
  const marks = scan({ legacy: LEGACY_NAME, rows: toLines(text), syntax });

  return marks.some((mark) => name === undefined || mark.name === name);
}

/**
 * The body of the first `repo:<name>` region of `text`, its markers read as loosely as `writeRegions` reads them
 * (hashed, unhashed or mangled; in a `#` file the legacy pair too); undefined when no open has a close after it.
 */
export function regionBody(text: string, syntax: RegionSyntax, name: string): string | undefined {
  const doc: Doc = { legacy: name.toLowerCase(), rows: toLines(text), syntax };
  const [pair] = pairUp(scan(doc).filter((mark) => mark.name === doc.legacy)).pairs;

  return pair === undefined ? undefined : doc.rows.slice(pair[0].at + 1, pair[1].at).join("\n");
}

function writeOne(doc: Shared, region: Region, at: number | undefined): Step {
  const body = toLines(region.body);
  const found = pairUp(scan(doc).filter((mark) => mark.name === region.name));
  const strays = dropStrays(doc.rows, found, new Set(body));
  const [main] = found.pairs;
  const kept = main === undefined ? { moved: [], repairs: [] } : inspect(doc, main, body);

  const block = [
    wrap(doc.syntax, `repo:${region.name} ${regionHash(region.body)}`),
    ...body,
    wrap(doc.syntax, `/repo:${region.name}`),
    ...kept.moved,
  ];

  let insert = at === undefined ? place(doc.rows, region.place, block) : { at, block };

  if (main !== undefined) insert = { at: addRange(strays.drop, main[0].at, main[1].at), block };
  else if (strays.at !== undefined) insert = { at: strays.at, block };

  return { repairs: [...kept.repairs, ...strayRepairs(found, region.name)], rows: emit(doc.rows, strays.drop, insert) };
}

/** What replacing the kept region changes: the user's lines to move below it and the repair lines. */
function inspect(doc: Shared, [open, close]: Pair, body: readonly string[]) {
  const { name } = open;

  if (open.legacy) return { moved: [], repairs: [`converted the old markers to repo:${name}`] };
  const words = open.hash === null ? `repo:${name}` : `repo:${name} ${open.hash}`;

  const exact =
    !doc.cr.has(name) && open.line === wrap(doc.syntax, words) && close.line === wrap(doc.syntax, `/repo:${name}`);

  const repairs = exact ? [] : [`rewrote the markers of repo:${name}`];

  if (open.hash === null) return { moved: [], repairs: [...repairs, `added the hash to repo:${name}`] };
  const old = doc.rows.slice(open.at + 1, close.at);

  if (open.hash === regionHash(old.join("\n"))) return { moved: [], repairs };
  const keep = new Set(body);
  const moved = old.filter((row) => row.trim() !== "" && !keep.has(row));

  if (moved.length === 0) return { moved, repairs };

  return { moved, repairs: [...repairs, `moved ${plural(moved.length, "edited line")} out of repo:${name}`] };
}

/**
 * Drops every region after the first and each stray marker with its run of new-body lines; `at` is where a stray
 * stood.
 */
function dropStrays(rows: readonly string[], found: Found, keep: ReadonlySet<string>) {
  const drop = new Set<number>();

  for (const [open, close] of found.pairs.slice(1)) addRange(drop, open.at, close.at);

  const starts = found.closes.map((close) =>
    addRange(drop, close.at - leading(rows.slice(0, close.at).toReversed(), keep), close.at),
  );

  const opens = found.opens.map((open) => addRange(drop, open.at, open.at + leading(rows.slice(open.at + 1), keep)));

  return { at: opens[0] ?? starts[0], drop };
}

function strayRepairs(found: Found, name: string): string[] {
  const extra = found.pairs.length - 1;
  const repairs = extra > 0 ? [`dropped ${extra} extra repo:${name}`] : [];
  const strays = found.opens.length + found.closes.length;

  if (strays === 0) return repairs;

  if (found.pairs.length > 0) return [...repairs, `dropped ${plural(strays, "stray marker")} of repo:${name}`];

  if (found.closes.length === 0) return [`closed repo:${name}`];

  if (found.opens.length === 0) return [`opened repo:${name}`];

  return [`reordered the markers of repo:${name}`];
}

/**
 * Cuts every region and stray marker sync wrote whose name `isCut` picks; one repair line per name. A marker with no
 * full hash (the legacy pair aside) may be the user's own text, so it and a pair it opens stay as they are.
 */
function cutNames(doc: Doc, isCut: (name: string) => boolean): Step {
  const marks = scan(doc).filter((mark) => isCut(mark.name));
  const names: string[] = [];
  const drop = new Set<number>();

  for (const name of new Set(marks.map((mark) => mark.name))) {
    const found = pairUp(marks.filter((mark) => mark.name === name));
    const pairs = found.pairs.filter(([open]) => isOurs(open));
    const strays = [...found.opens, ...found.closes].filter(isOurs);

    for (const [open, close] of pairs) addRange(drop, open.at, close.at);

    for (const mark of strays) drop.add(mark.at);

    if (pairs.length + strays.length > 0) names.push(name);
  }

  const repairs = names.map((name) => (name === LEGACY_NAME ? "cut the old markers" : `cut repo:${name}`));

  return { repairs, rows: emit(doc.rows, drop, { at: doc.rows.length, block: [] }) };
}

/** Where a region with no marker goes: the bottom after a blank line, or the top past a header or frontmatter. */
function place(rows: readonly string[], where: Region["place"], block: string[]): Insert {
  if (where === "bottom") return { at: rows.length, block: rows.length === 0 ? block : ["", ...block] };
  const at = topOf(rows);

  return { at, block: (rows[at] ?? "").trim() === "" ? block : [...block, ""] };
}

/** The line a top region goes before: past an owned header, past a closed frontmatter, else the first. */
function topOf(rows: readonly string[]): number {
  const [first = ""] = rows;

  if (OWNED_LOOSE.test(first)) return 1;

  // `indexOf` finding no second fence gives 0, the first line.
  return first === FENCE ? rows.indexOf(FENCE, 1) + 1 : 0;
}

/** `rows` without the dropped lines and with `insert` spliced in; a blank line a cut leaves doubled is dropped too. */
function emit(rows: readonly string[], drop: ReadonlySet<number>, insert: Insert): string[] {
  const out: string[] = [];
  let isGap = false;
  let isBlankBefore = true;

  for (const [at, row] of rows.entries()) {
    if (at === insert.at) {
      out.push(...insert.block);
      isBlankBefore = false;
    }

    if (drop.has(at)) {
      isGap = true;
      continue;
    }

    const isBlank = row.trim() === "";

    if (!(isGap && isBlank && isBlankBefore)) out.push(row);
    isBlankBefore = isBlank;
    isGap = false;
  }

  if (insert.at >= rows.length) out.push(...insert.block);

  return out;
}

/** How many of `rows`, from the first, are lines of the new body: the run a stray marker takes with it. */
function leading(rows: readonly string[], keep: ReadonlySet<string>): number {
  const stop = rows.findIndex((row) => !keep.has(row));

  return stop < 0 ? rows.length : stop;
}

/** Adds `from` through `to` to `drop`; gives `from`. */
function addRange(drop: Set<number>, from: number, to: number): number {
  for (let at = from; at <= to; at += 1) drop.add(at);

  return from;
}

function wrap(syntax: RegionSyntax, words: string): string {
  return syntax === HTML_OPEN ? `${HTML_OPEN} ${words} ${HTML_CLOSE}` : `# ${words}`;
}

/**
 * The names of the regions with a marker line of `doc` that ends in CR in `text`, when some other line of it ends in
 * LF alone: a tool mangled the marker. A file all CRLF, as a Windows checkout writes it, has none.
 */
function crMarked(text: string, doc: Doc): Set<string> {
  const ended = (text.startsWith(BOM) ? text.slice(BOM.length) : text).split("\n");
  ended.pop();
  const isCr = ended.map((row) => row.endsWith("\r"));

  if (!isCr.includes(false)) return new Set();

  return new Set(
    scan(doc)
      .filter((mark) => isCr[mark.at] === true)
      .map((mark) => mark.name),
  );
}

/** `text` as lines, the BOM, CRs and trailing blank lines gone. */
function toLines(text: string): string[] {
  const trimmed = (text.startsWith(BOM) ? text.slice(BOM.length) : text).trimEnd();

  return trimmed === "" ? [] : trimmed.split(LINE_BREAK);
}

/** LF lines ending in one newline; nothing at all when no line is left. */
function finish(rows: readonly string[]): string {
  const text = rows.join("\n").trimEnd();

  return text === "" ? "" : `${text}\n`;
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}
