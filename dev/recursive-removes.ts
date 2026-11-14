/**
 * Finds recursive removes: calls to `rm` or `rmSync`, bare or as a member (`fs.rmSync`, `fsp.rm`), with an object
 * argument that holds `recursive`. Strings and comments never match, and a call split over lines is one call.
 */
import { isSyntaxList, type SyntaxValue, textOf } from "../cli/syntax-node.ts";
import { NODE, RECURSIVE, REMOVES } from "./recursive-removes.constants.ts";
import { get, matchingLines } from "./source-scan.ts";

/** The name a callee calls: an identifier's, or a non-computed member's property; null for anything else. */
function calleeName(callee: SyntaxValue): string | null {
  if (get(callee, "type") === NODE.identifier) return textOf(get(callee, "name"));

  if (get(callee, "type") !== NODE.member || get(callee, "computed") === true) return null;

  return textOf(get(get(callee, "property"), "name"));
}

/** True for an object literal with a `recursive` key. */
function hasRecursive(arg: SyntaxValue): boolean {
  if (get(arg, "type") !== NODE.object) return false;
  const properties = get(arg, "properties");

  return isSyntaxList(properties) && properties.some((p) => textOf(get(get(p, "key"), "name")) === RECURSIVE);
}

function isRecursiveRemove(node: SyntaxValue): boolean {
  if (get(node, "type") !== NODE.call) return false;
  const name = calleeName(get(node, "callee"));
  const args = get(node, "arguments");

  return name !== null && REMOVES.has(name) && isSyntaxList(args) && args.some(hasRecursive);
}

/** The 1-based line of each recursive remove in `source`, which `rel` names (its extension picks the parser). */
export function recursiveRemoves(rel: string, source: string): number[] {
  return source.includes(RECURSIVE) ? matchingLines(rel, source, isRecursiveRemove) : [];
}
