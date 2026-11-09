/**
 * The comments no rule may hide behind: a lint disable, `@ts-ignore`, `@ts-nocheck`, and an `@ts-expect-error` with no
 * written reason. A script and not an oxlint rule, since oxlint honors its own disable comments. Each directive is
 * matched as the tool that obeys it reads it, so a string or prose that mentions one passes.
 */
import fs from "node:fs";
import path from "node:path";
import { parseSync, type Comment } from "oxc-parser";
import { isReason } from "./lint/is-reason.ts";
import { runGit } from "./sync/standards.ts";

/** ts tsx mts cts js jsx mjs cjs. */
const SOURCE = /\.(?:[jt]sx?|[cm][jt]s)$/;
const LINE_BREAK = /\r\n?|[\n\u2028\u2029]/g;
const HASHBANG = /^#!.*/;
/** oxlint's (and eslint's) directive: the word first in the trimmed text, then a space or the end. */
const DISABLE = /^((?:eslint|oxlint)-disable(?:-next-line|-line)?)(?:\s|$)/;
/** TypeScript's `commentDirectiveRegExSingleLine`, on the whole `//` comment. */
const TS_LINE = /^\/\/\/?\s*@(ts-expect-error|ts-ignore)/;
/** TypeScript's `commentDirectiveRegExMultiLine`, on the trimmed last line of a block comment. */
const TS_BLOCK = /^(?:\/|\*)*\s*@(ts-expect-error|ts-ignore)/;
/** TypeScript's `singleLinePragmaRegEx`, read on the `//` comments before the file's first token. */
const PRAGMA = /^\/\/\/?\s*@([^\s:]+)(?:(?:[^\S\r\n]|:).*)?$/;

const IGNORE = '"@ts-ignore" hides a type error; fix the type, or write @ts-expect-error with a reason';
const NOCHECK = '"@ts-nocheck" turns type checking off for the file; fix the types instead';
const EXPECT = '"@ts-expect-error" needs a reason: // @ts-expect-error <why this line must not compile>';

/** A refused comment: where in the file its directive starts, and what to do instead. */
type Hit = { at: number; message: string };
/** The source files of a checkout, or why git could not list them. */
export type Listed = { ok: true; files: string[] } | { ok: false; errors: string[] };

const isSource = (rel: string) => SOURCE.test(rel) && !rel.split("/").includes("fixtures");
const lineOf = (source: string, at: number) => (source.slice(0, at).match(LINE_BREAK) ?? []).length + 1;

function disableHit(comment: Comment): Hit | null {
  const trimmed = comment.value.trimStart();
  const word = DISABLE.exec(trimmed)?.[1];
  if (word === undefined) return null;
  const at = comment.end - (comment.type === "Block" ? 2 : 0) - trimmed.length;
  return { at, message: `"${word}" switches a lint rule off; fix the code instead` };
}

/** The text TypeScript reads a directive from, and where it starts: a block comment's last line, from `/*` or after. */
function directiveLine(comment: Comment): { text: string; at: number } {
  if (comment.type === "Line") return { text: `//${comment.value}`, at: comment.start };
  const raw = `/*${comment.value}*/`;
  const breaks = [...raw.matchAll(LINE_BREAK)];
  const last = breaks.at(-1);
  const offset = last === undefined ? 0 : last.index + last[0].length;
  return { text: raw.slice(offset), at: comment.start + offset };
}

function tsHit(comment: Comment): Hit | null {
  const { text, at } = directiveLine(comment);
  const trimmed = text.trimStart();
  const match = (comment.type === "Line" ? TS_LINE : TS_BLOCK).exec(trimmed);
  if (match === null) return null;
  const start = at + text.length - trimmed.length;
  if (match[1] === "ts-ignore") return { at: start, message: IGNORE };
  const rest = trimmed.slice(match[0].length).replace(/\*\/$/, "");
  return isReason(rest) ? null : { at: start, message: EXPECT };
}

/** The comments before the first token, past a `#!` line, where TypeScript reads its file pragmas. */
function leading(source: string, comments: readonly Comment[]): Comment[] {
  let edge = HASHBANG.exec(source)?.[0].length ?? 0;
  const found: Comment[] = [];
  for (const comment of comments) {
    if (source.slice(edge, comment.start).trim() !== "") break;
    found.push(comment);
    edge = comment.end;
  }
  return found;
}

function nocheckHit(comment: Comment): Hit | null {
  if (comment.type !== "Line") return null;
  const name = PRAGMA.exec(`//${comment.value}`)?.[1];
  return name?.toLowerCase() === "ts-nocheck" ? { at: comment.start, message: NOCHECK } : null;
}

/** Every refused comment of one file, in the order they appear. */
function hitsOf(rel: string, source: string): Hit[] {
  const { comments } = parseSync(rel, source);
  const nochecks = leading(source, comments).map(nocheckHit);
  const hits = [...comments.flatMap((comment) => [disableHit(comment), tsHit(comment)]), ...nochecks];
  return hits.filter((hit) => hit !== null).sort((a, b) => a.at - b.at);
}

function readSource(file: string): string | null {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

/**
 * One `<file>:<line>: <message>` per refused comment in the source files of `files` (paths relative to `root`); a file
 * that cannot be read is skipped, and one that does not parse is scanned on the comments the parser still returns.
 */
export function commentProblems(root: string, files: readonly string[]): string[] {
  return files.filter(isSource).flatMap((rel) => {
    const source = readSource(path.join(root, rel));
    if (source === null) return [];
    return hitsOf(rel, source).map((hit) => `${rel}:${lineOf(source, hit.at)}: ${hit.message}`);
  });
}

/** The tracked and untracked, not ignored, source files under `root`, outside any `fixtures` dir, sorted. */
export function sourceFiles(root: string): Listed {
  const run = runGit(root, ["ls-files", "-z", "--cached", "--others", "--exclude-standard"]);
  if (run.status !== 0) return { ok: false, errors: [`git ls-files failed: ${run.stderr.trim()}`] };
  return { ok: true, files: [...new Set(run.stdout.split("\0").filter(isSource))].sort() };
}

/** `commentProblems` over every source file of the checkout at `root`, as `repo check` runs it. */
export function checkComments(root: string): string[] {
  const listed = sourceFiles(root);
  return listed.ok ? commentProblems(root, listed.files) : listed.errors;
}
