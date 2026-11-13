#!/usr/bin/env bun
/** Backlog: add, list, start, mark done and clear the items of `<root>/.repo/backlog.md`. */
import fs from "node:fs";
import path from "node:path";

import {
  already,
  ambiguous,
  askClear,
  BACKLOG_DIR,
  BACKLOG_NAME,
  BACKLOG_REL,
  BOX_DONE,
  BOX_GROUP,
  BOX_ORDER,
  BOX_PROGRESS,
  cleared,
  CR_END_RE,
  CRLF,
  EMPTY,
  EXIT_USAGE,
  ITEM_RE,
  LAST,
  LINE_NUMBER_RE,
  NEWLINE,
  NEWLINES_RE,
  TAIL_BYTES,
  noLine,
  noMatch,
  NO_DONE,
  notItem,
  notItems,
  USAGE,
  YES_FLAG,
} from "./backlog.constants.ts";
import { resolveRoots, type Roots } from "./workspace-root.ts";

/** One item line: its 1-based number, its box character and its text without the line ending. */
export type Item = { n: number; box: string; line: string };

/** What `clear` removes: the count and the text left. */
export type Cleared = { removed: number; text: string };

/** The line a `<N|text>` argument names, or why it names none. */
export type Target = { ok: true; n: number } | { ok: false; message: string };

/** A pure box edit: the new text and the line to print, an item that is already set, or a refusal. */
export type Edit =
  | { kind: "changed"; text: string; n: number; line: string }
  | { kind: "same"; message: string }
  | { kind: "refused"; message: string };

type Verb = (rest: string[], roots: Roots) => number;

/** The lines of `text` with their endings kept; the empty piece after a final newline is not a line. */
function linesOf(text: string): string[] {
  const lines = text.split(NEWLINE);

  if (lines.at(LAST) === "") lines.pop();

  return lines;
}

/** The item a line holds, or null for the person's own text. */
export function parseItem(line: string, n: number): Item | null {
  const box = ITEM_RE.exec(line)?.[BOX_GROUP];

  return box === undefined ? null : { box: box.toLowerCase(), line: line.replace(CR_END_RE, ""), n };
}

function itemsOf(text: string) {
  const items: Item[] = [];
  let other = 0;

  for (const [i, line] of linesOf(text).entries()) {
    const item = parseItem(line, i + 1);

    if (item === null) other += 1;
    else items.push(item);
  }

  return { items, other };
}

/** The `list` output lines: open first, then in progress, then done, and the count of lines that are not items. */
export function listText(text: string): string[] {
  if (linesOf(text).length === 0) return [EMPTY];
  const { items, other } = itemsOf(text);
  const sorted = items.toSorted((a, b) => BOX_ORDER.indexOf(a.box) - BOX_ORDER.indexOf(b.box));
  const rows = sorted.map((i) => `${i.n}  ${i.line}`);

  return other === 0 ? rows : [...rows, notItems(other)];
}

/** The line a `<N|text>` argument names: a number, or the one item line holding the text. */
export function resolveTarget(text: string, arg: string): Target {
  if (LINE_NUMBER_RE.test(arg)) {
    const n = Number(arg);

    return n >= 1 && n <= linesOf(text).length ? { n, ok: true } : { message: noLine(n), ok: false };
  }

  const hits = itemsOf(text)
    .items.filter((i) => i.line.includes(arg))
    .map((i) => i.n);

  const [first = 0] = hits;

  if (hits.length === 0) return { message: noMatch(arg), ok: false };

  return hits.length === 1 ? { n: first, ok: true } : { message: ambiguous(arg, hits), ok: false };
}

/** Set the box of line `n` to `box`, changing nothing else in `text`. */
export function setBox(text: string, n: number, box: string): Edit {
  const lines = text.split(NEWLINE);
  const old = lines.slice(n - 1, n).join("");
  const item = parseItem(old, n);

  if (item === null) return { kind: "refused", message: notItem(n) };

  const state = box === BOX_DONE ? "done" : "in progress";

  if (item.box === box) return { kind: "same", message: already(n, state) };
  const line = old.replace(ITEM_RE, `$1${box}$3`);

  lines[n - 1] = line;

  return { kind: "changed", line: line.replace(CR_END_RE, ""), n, text: lines.join(NEWLINE) };
}

/** How many done item lines `text` holds, and `text` without them. */
export function clearDone(text: string): Cleared {
  const lines = text.split(NEWLINE);
  const count = linesOf(text).length;
  const kept = lines.filter((line, i) => i >= count || parseItem(line, i + 1)?.box !== BOX_DONE);

  return { removed: lines.length - kept.length, text: kept.join(NEWLINE) };
}

/** The text of an `add`: the words joined, line breaks flattened. */
export function addText(words: readonly string[]): string {
  return words.join(" ").replace(NEWLINES_RE, " ").trim();
}

/** What an append of `item` writes: a missing newline first, then the item and its ending. */
export function appendBytes(args: { crlf: boolean; endsWithNewline: boolean; item: string }): string {
  const eol = args.crlf ? CRLF : NEWLINE;

  return `${args.endsWithNewline ? "" : eol}- [ ] ${args.item}${eol}`;
}

function write(msg: string, stream: NodeJS.WriteStream = process.stdout): void {
  stream.write(`${msg}\n`);
}

function fail(msg: string, code = 1): number {
  write(msg, process.stderr);

  return code;
}

function usage(): number {
  return fail(USAGE, EXIT_USAGE);
}

function fileOf(roots: Roots): string {
  return path.join(roots.root, BACKLOG_DIR, BACKLOG_NAME);
}

function readText(file: string): string {
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
}

function listVerb(rest: string[], roots: Roots): number {
  if (rest.length > 0) return usage();

  for (const row of listText(readText(fileOf(roots)))) write(row);

  return 0;
}

/** The last `TAIL_BYTES` bytes of the file behind `fd`, or all of it when shorter. */
function tailOf(fd: number, size: number): string {
  const len = Math.min(size, TAIL_BYTES);
  const buf = Buffer.alloc(len);

  fs.readSync(fd, buf, 0, len, size - len);

  return buf.toString("latin1");
}

/** Read the last bytes, then append with one O_APPEND write, so writers at once both land. */
function addVerb(rest: string[], roots: Roots): number {
  const item = addText(rest);

  if (item === "") return usage();
  const file = fileOf(roots);

  fs.mkdirSync(path.dirname(file), { recursive: true });
  const fd = fs.openSync(file, "a+");

  try {
    const { size } = fs.fstatSync(fd);
    const tail = tailOf(fd, size);
    const endsWithNewline = size === 0 || tail.endsWith(NEWLINE);
    const crlf = endsWithNewline ? tail === CRLF : size > 0 && fs.readFileSync(file, "utf8").includes(CRLF);

    fs.writeSync(fd, appendBytes({ crlf, endsWithNewline, item }));
  } finally {
    fs.closeSync(fd);
  }

  write(`${BACKLOG_REL}:${linesOf(readText(file)).length}  - [ ] ${item}`);

  return 0;
}

function boxVerb(rest: string[], roots: Roots, box: string): number {
  const arg = rest.join(" ");

  if (arg === "") return usage();
  const file = fileOf(roots);
  const text = readText(file);
  const target = resolveTarget(text, arg);

  if (!target.ok) return fail(target.message);
  const edit = setBox(text, target.n, box);

  if (edit.kind === "refused") return fail(edit.message);

  if (edit.kind === "same") {
    write(edit.message);

    return 0;
  }

  fs.writeFileSync(file, edit.text);
  write(`${BACKLOG_REL}:${edit.n}  ${edit.line}`);

  return 0;
}

function clearVerb(rest: string[], roots: Roots): number {
  const [flag, ...extra] = rest;

  if (extra.length > 0 || (flag !== undefined && flag !== YES_FLAG)) return usage();
  const file = fileOf(roots);
  const { removed, text } = clearDone(readText(file));

  if (removed === 0) {
    write(NO_DONE);
  } else if (flag === undefined) {
    write(askClear(removed));
  } else {
    fs.writeFileSync(file, text);
    write(cleared(removed));
  }

  return 0;
}

const VERBS: ReadonlyMap<string, Verb> = /* @__PURE__ */ new Map([
  ["list", listVerb],
  ["add", addVerb],
  ["start", (rest, roots) => boxVerb(rest, roots, BOX_PROGRESS)],
  ["done", (rest, roots) => boxVerb(rest, roots, BOX_DONE)],
  ["clear", clearVerb],
]);

export function main(argv: string[], roots: () => Roots = resolveRoots): number {
  try {
    const [cmd = "list", ...rest] = argv;
    const verb = VERBS.get(cmd);

    return verb === undefined ? usage() : verb(rest, roots());
  } catch (err) {
    return fail((err /* fs and the roots lookup throw Errors */ as Error).message);
  }
}
