/**
 * Finds key-line regexes whose space after the key can cross a line: a regex literal, or a `RegExp` call or `new` with
 * a string or template pattern, whose flags hold `m` and whose pattern has `\s` right after a key's `:` or `=`. In `m`
 * mode `\s` matches the newline, so an empty `KEY:` takes the next line as its value; `[ \t]` stays on the line.
 */
import { isSyntaxList, isSyntaxString, type SyntaxValue, textOf } from "../cli/syntax-node.ts";
import {
  CLASS_CLOSE,
  CLASS_OPEN,
  ESCAPE,
  GROUP_HEADS,
  HOLE,
  KEY_ENDS,
  MULTILINE,
  NODE,
  REGEXP,
  SPACE,
} from "./key-line-regexes.constants.ts";
import { get, matchingLines } from "./source-scan.ts";

/** Whether the `:` or `=` at `at` ends a group head (`(?:`, `(?=`, `(?<=`) rather than a key. */
function endsGroupHead(pattern: string, at: number): boolean {
  const before = pattern.slice(0, at);

  return GROUP_HEADS.some((head) => before.endsWith(head));
}

/** Whether `pattern` has `\s` right after a key's `:` or `=`, outside a character class. */
export function crossesAfterKey(pattern: string): boolean {
  let isInClass = false;

  for (let at = 0; at < pattern.length; at++) {
    const char = pattern[at];

    if (char === ESCAPE) {
      const key = at - 1;

      if (!isInClass && pattern[at + 1] === SPACE && KEY_ENDS.has(pattern[key] ?? "") && !endsGroupHead(pattern, key))
        return true;
      at++;
    } else if (isInClass) {
      isInClass = char !== CLASS_CLOSE;
    } else {
      isInClass = char === CLASS_OPEN;
    }
  }

  return false;
}

/** The text a string or template argument holds, each `${…}` read as `HOLE`; null for any other node. */
function textArg(arg: SyntaxValue): string | null {
  const value = get(arg, "value");

  if (get(arg, "type") === NODE.literal && isSyntaxString(value)) return value;

  if (get(arg, "type") !== NODE.template) return null;
  const quasis = get(arg, "quasis");

  return isSyntaxList(quasis) ? quasis.map((q) => textOf(get(get(q, "value"), "cooked"))).join(HOLE) : null;
}

/** The pattern and flags `node` builds a regex from, or null when it builds none this check can read. */
function regexOf(node: SyntaxValue): { pattern: string; flags: string } | null {
  const type = get(node, "type");
  const regex = get(node, "regex");

  if (type === NODE.literal && regex !== undefined)
    return { flags: textOf(get(regex, "flags")), pattern: textOf(get(regex, "pattern")) };

  if (type !== NODE.new && type !== NODE.call) return null;
  const callee = get(node, "callee");
  const args = get(node, "arguments");

  if (get(callee, "type") !== NODE.identifier || textOf(get(callee, "name")) !== REGEXP || !isSyntaxList(args))
    return null;
  const pattern = textArg(args[0]);
  const flags = textArg(args[1]);

  return pattern === null || flags === null ? null : { flags, pattern };
}

function isKeyLineRegex(node: SyntaxValue): boolean {
  const regex = regexOf(node);

  return regex !== null && regex.flags.includes(MULTILINE) && crossesAfterKey(regex.pattern);
}

/** The 1-based line of each key-line regex in `source`, which `rel` names (its extension picks the parser). */
export function keyLineRegexes(rel: string, source: string): number[] {
  return source.includes(`${ESCAPE}${SPACE}`) ? matchingLines(rel, source, isKeyLineRegex) : [];
}
