/**
 * The key order of one JSON or JSONC text. Every object's members are sorted by code unit, deep, with arrays left in
 * order. A member is its lead (indent, own-line comments above it), its body (key to value) and its trail (what shares
 * the value's line) and moves whole; the commas, the line breaks and the text after the opening brace stay where they
 * were, and so do comments with no key after them. Text that does not parse is left alone.
 */
import { createScanner, type Node, type ParseError, parseTree } from "jsonc-parser";

import {
  ARRAY_NODE,
  BLOCK_COMMENT_TOKEN,
  COMMA_TOKEN,
  CRLF,
  EOF_TOKEN,
  LF,
  LINE_BREAK_TOKEN,
  LINE_COMMENT_TOKEN,
  OBJECT_NODE,
  PATH_SEPARATOR,
  SPACE_TOKEN,
} from "./sorted-json-text.constants.ts";

type Sorted = { text: string; key: string };
type Ctx = { text: string; eol: string };
type Token = { kind: number; start: number; end: number };
/**
 * The text between two members. `pre` (before the comma) and `post` (the rest of the value's line) move with the member
 * before, `lead` with the member after; `sep` (the comma), `padBefore`, `ws` and `lb` (the line break) stay.
 */
type Gap = {
  pre: string;
  padBefore: string;
  sep: string;
  post: string;
  ws: string;
  lb: string;
  lead: string;
  trailsLineComment: boolean;
};
type Member = { key: string; lead: string; body: string; pre: string; post: string; trailsLineComment: boolean };

const at = <T>(list: readonly T[], index: number): T => list[index] /* the caller's index is in range */ as T;
const children = (node: Node): Node[] => node.children /* an object or an array has a list, empty or not */ as Node[];
/** A property node's key and value. */
const pair = (prop: Node): [Node, Node] => children(prop) /* a property has both */ as [Node, Node];
const end = (node: Node): number => node.offset + node.length;
const keyOf = (prop: Node): string => String(at(children(prop), 0).value);
/** Code-unit order, which `<` on strings is. */
const byKey = (a: Member, b: Member): number => Number(a.key > b.key) - Number(a.key < b.key);

function tokens(text: string): Token[] {
  const scanner = createScanner(text, false);
  const found: Token[] = [];
  for (let kind = scanner.scan(); kind !== EOF_TOKEN; kind = scanner.scan())
    found.push({ end: scanner.getTokenOffset() + scanner.getTokenLength(), kind, start: scanner.getTokenOffset() });

  return found;
}

/** Whether the last token before `limit`, apart from spaces and commas, is a line comment. */
const endsInLineComment = (list: Token[], limit: number): boolean =>
  list.findLast((t) => t.end <= limit && t.kind !== SPACE_TOKEN && t.kind !== COMMA_TOKEN)?.kind === LINE_COMMENT_TOKEN;

/** Where the parts of a gap lie: the comma, the first line break after it, and where the moving trail ends. */
type Spans = { pre: number; sep: number; cut: number; after: number; lb: Token; trails: boolean; hasLb: boolean };

/** The first token of `kind` at or after `from`, or an empty one at `none`. */
function firstOf(list: Token[], find: { kind: number; from: number; none: number }): Token {
  const { kind, from, none } = find;
  return list.find((t) => t.kind === kind && t.start >= from) ?? { end: none, kind, start: none };
}

function spansOf(list: Token[], len: number, opens: boolean): Spans {
  const comma = firstOf(list, { from: opens ? len : 0, kind: COMMA_TOKEN, none: 0 });
  const lb = firstOf(list, { from: comma.end, kind: LINE_BREAK_TOKEN, none: len });
  const hasLb = lb.end > lb.start;
  const trails = !opens && (hasLb || comma.end === 0);
  const cut =
    trails || hasLb ? lb.start : firstOf(list, { from: comma.end, kind: BLOCK_COMMENT_TOKEN, none: len }).start;
  return { after: hasLb ? lb.end : cut, cut, hasLb, lb, pre: comma.start, sep: comma.end, trails };
}

/** Whether a comment lies within `from` to `to`. */
const hasNote = (list: Token[], from: number, to: number): boolean =>
  list.some((t) => (t.kind === LINE_COMMENT_TOKEN || t.kind === BLOCK_COMMENT_TOKEN) && t.start >= from && t.end <= to);

/** `text` as [moving, staying]: all of it moves when it holds a comment, and none when it is only spacing. */
const divide = (moves: boolean, text: string): [string, string] => (moves ? [text, ""] : ["", text]);

/** The gap after a member's value, or after the opening brace (`opens`), split into what moves and what stays. */
function gapOf(text: string, opens: boolean): Gap {
  const list = tokens(text);
  const span = spansOf(list, text.length, opens);
  const [pre, padBefore] = divide(hasNote(list, 0, span.pre), text.slice(0, span.pre));
  const movesPost = span.trails && hasNote(list, span.sep, span.cut);
  const [post, ws] = divide(movesPost, text.slice(span.sep, span.cut));
  return {
    lb: text.slice(span.lb.start, span.lb.end),
    lead: text.slice(span.after),
    padBefore,
    post,
    pre,
    sep: text.slice(span.pre, span.sep),
    trailsLineComment: movesPost && span.hasLb && endsInLineComment(list, span.lb.start),
    ws,
  };
}

/** The gaps of an object's text: before its first member, then after each member. */
function gapsOf(node: Node, text: string): Gap[] {
  const props = children(node);
  const starts = [node.offset + 1, ...props.map(end)];
  return starts.map((start, i) => gapOf(text.slice(start, props[i]?.offset ?? end(node) - 1), i === 0));
}

function render(node: Node, ctx: Ctx): string {
  if (node.type === OBJECT_NODE) return renderObject(node, ctx);
  if (node.type === ARRAY_NODE) return renderArray(node, ctx);
  return ctx.text.slice(node.offset, end(node));
}

/** An array's text with the objects inside it sorted, the items in order. */
function renderArray(node: Node, ctx: Ctx): string {
  let out = "";
  let from = node.offset;
  for (const item of children(node)) {
    out += `${ctx.text.slice(from, item.offset)}${render(item, ctx)}`;
    from = end(item);
  }
  return `${out}${ctx.text.slice(from, end(node))}`;
}

function membersOf(node: Node, gaps: Gap[], ctx: Ctx): Member[] {
  return children(node).map((prop, i) => {
    const [, value] = pair(prop);
    const body = `${ctx.text.slice(prop.offset, value.offset)}${render(value, ctx)}`;
    const { pre, post, trailsLineComment } = at(gaps, i + 1);
    return { body, key: keyOf(prop), lead: at(gaps, i).lead, post, pre, trailsLineComment };
  });
}

/** What goes at one position: a member with the separator, line break and spacing that position had. */
function place(member: Member, gap: Gap, ctx: Ctx): string {
  const eol = member.trailsLineComment && gap.lb === "" ? ctx.eol : "";
  return `${member.lead}${member.body}${member.pre}${gap.padBefore}${gap.sep}${member.post}${eol}${gap.ws}${gap.lb}`;
}

/** An object's text with its members sorted, and the objects inside them. */
function renderObject(node: Node, ctx: Ctx): string {
  const gaps = gapsOf(node, ctx.text);
  const sorted = membersOf(node, gaps, ctx).sort(byKey);
  const open = at(gaps, 0);
  const body = sorted.map((member, i) => place(member, at(gaps, i + 1), ctx)).join("");
  const tail = `${at(gaps, gaps.length - 1).lead}${ctx.text.slice(end(node) - 1, end(node))}`;
  return `${ctx.text.slice(node.offset, node.offset + 1)}${open.ws}${open.lb}${body}${tail}`;
}

/** The path of the first key out of order below `node`, in document order, or null. */
function firstOutOfOrder(node: Node, parents: readonly string[]): string | null {
  const isObject = node.type === OBJECT_NODE;
  if (!isObject && node.type !== ARRAY_NODE) return null;
  const kids = children(node);
  const keys = isObject ? kids.map(keyOf) : [];
  const late = keys.findIndex((key, i) => i > 0 && key < at(keys, i - 1));
  if (late > 0) return [...parents, at(keys, late)].join(PATH_SEPARATOR);
  for (const [i, kid] of kids.entries()) {
    const found = isObject
      ? firstOutOfOrder(at(children(kid), 1), [...parents, at(keys, i)])
      : firstOutOfOrder(kid, [...parents, String(i)]);
    if (found !== null) return found;
  }
  return null;
}

/**
 * `text` with its keys sorted and the path of the first key that was out of order, or null when they are in order or
 * `text` does not parse as JSON with comments.
 */
export function sortedJsonText(text: string): Sorted | null {
  const errors: ParseError[] = [];
  const root = parseTree(text, errors, { allowTrailingComma: true, disallowComments: false });
  if (root === undefined || errors.length > 0) return null;
  const key = firstOutOfOrder(root, []);
  if (key === null) return null;
  const ctx = { eol: text.includes(CRLF) ? CRLF : LF, text };
  return { key, text: `${text.slice(0, root.offset)}${render(root, ctx)}${text.slice(end(root))}` };
}
