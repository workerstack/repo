/** Where a quoted or nested span of a shell command ends, and what an ANSI-C `$'…'` span spells. */

import { CONTROL_LEAD, HEX_LEADS } from "./shell-spans.constants.ts";

/** A backslash and the character it escapes. */
export const PAIR_LENGTH = 2;

/**
 * One ANSI-C escape after its backslash: `\x`, `\u` or `\U` and hex digits, `\c` and a character, octal digits, or
 * a named one.
 */
const ANSI_C_RE = /\\(x[\da-fA-F]{1,2}|u[\da-fA-F]{1,4}|U[\da-fA-F]{1,8}|c.|[0-7]{1,3}|[abeEfnrtv\\'"?])/gsu;

/** What each named ANSI-C escape stands for. */
const NAMED_ESCAPES: ReadonlyMap<string, string> = /* @__PURE__ */ new Map([
  ['"', '"'],
  ["'", "'"],
  ["?", "?"],
  ["E", "\u001B"],
  ["\\", "\\"],
  ["a", "\u0007"],
  ["b", "\b"],
  ["e", "\u001B"],
  ["f", "\f"],
  ["n", "\n"],
  ["r", "\r"],
  ["t", "\t"],
  ["v", "\v"],
]);

const OCTAL = 8;
const HEX = 16;
const CONTROL_MASK = 0x1f;
const MAX_CODE_POINT = 0x10_ff_ff;

/** The index of the next `close` at or after `from` that no backslash escapes, or the end of `cmd`. */
function unescaped(cmd: string, from: number, close: string): number {
  let at = from;

  while (at < cmd.length && cmd[at] !== close) at += cmd[at] === "\\" ? PAIR_LENGTH : 1;

  return Math.min(at, cmd.length);
}

/** The index just past a quoted or backticked span that opens at `at`, or the end of `cmd`. */
export function pastQuoted(cmd: string, at: number): number {
  const close = cmd.charAt(at);
  const end = close === "'" ? cmd.indexOf("'", at + 1) : unescaped(cmd, at + 1, close);

  return end < 0 ? cmd.length : end + 1;
}

/** The index of the `close` that pairs with an `open` before `from`, or the end of `cmd`; skips quotes and escapes. */
export function pairEnd(cmd: string, from: number, [open, close]: string): number {
  let depth = 1;
  let at = from;

  while (at < cmd.length) {
    const ch = cmd.charAt(at);

    if (ch === close && --depth === 0) return at;

    if (ch === open) depth++;

    if ("'\"`".includes(ch)) at = pastQuoted(cmd, at);
    else at += ch === "\\" ? PAIR_LENGTH : 1;
  }

  return cmd.length;
}

/** The index of the `}` that closes a `${` whose body starts at `from`, or the end of `cmd`. */
export function braceEnd(cmd: string, from: number): number {
  return pairEnd(cmd, from, "{}");
}

/** The index of the backtick that closes one whose body starts at `from`, or the end of `cmd`. */
export function backtickEnd(cmd: string, from: number): number {
  return unescaped(cmd, from, "`");
}

/** The index of the `'` that closes a `$'` whose body starts at `from`, or the end of `cmd`. */
export function ansiCEnd(cmd: string, from: number): number {
  return unescaped(cmd, from, "'");
}

/** A code point as text, or the escape unchanged when the number is past Unicode. */
function codePoint(code: number, escape: string): string {
  return code > MAX_CODE_POINT ? escape : String.fromCodePoint(code);
}

/** The text bash makes of the body of a `$'…'` span; an escape it does not know keeps its backslash. */
export function decodeAnsiC(body: string): string {
  return body.replaceAll(ANSI_C_RE, (escape: string, code: string) => decodeEscape(escape, code));
}

/** The character the escape `escape`, `\` and `code`, stands for. */
function decodeEscape(escape: string, code: string): string {
  const lead = code.charAt(0);

  if (HEX_LEADS.includes(lead)) return codePoint(Number.parseInt(code.slice(1), HEX), escape);

  if (lead === CONTROL_LEAD) return String.fromCodePoint(code.charCodeAt(1) & CONTROL_MASK);

  if (lead >= "0" && lead <= "7") return String.fromCodePoint(Number.parseInt(code, OCTAL));

  return String(NAMED_ESCAPES.get(lead));
}
