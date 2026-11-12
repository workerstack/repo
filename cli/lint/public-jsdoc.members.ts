import { docFault } from "./doc-fault.ts";
import { isRecord } from "./manifest.ts";
import { COMPUTED, FAULTS, KIND, MEMBERS, NODE_TYPES, SIGNATURES } from "./public-jsdoc.constants.ts";
import { get, isHiddenMember, nodesOf, walkPublic } from "./public-surface.syntax.ts";
import type { Node } from "./public-surface.types.ts";
import type { RuleComment } from "./rule.types.ts";
import { statesItsType } from "./states-its-type.ts";

/** The file's text and the comments before a node, as oxlint's `SourceCode` gives them. */
export type Source = { text: string; before: (node: Node) => readonly RuleComment[] };
/** One public declaration being checked: `owner` is its name, and `fail` reports a fault finishing "… and ". */
export type Walk = { source: Source; owner: string; fail: (node: Node, label: string, text: string) => void };

function keyName(key: unknown): string {
  const label = [get(key, "name"), get(key, "value")].find(
    (part) => typeof part === "string" || typeof part === "number" || typeof part === "bigint",
  );
  return label === undefined ? COMPUTED : String(label);
}
function isUnnameable(node: Node): boolean {
  return node["computed"] === true && get(node["key"], "type") === NODE_TYPES.identifier;
}

function jsdocOf(source: Source, node: Node): RuleComment | undefined {
  return source
    .before(node)
    .filter((comment) => comment.type === NODE_TYPES.block && comment.value.startsWith("*"))
    .pop();
}

/** TypeScript attaches a member's doc only from comments after a line break, so `{ /** x *\/ a: string }` is no doc. */
function sharesLine(source: Source, comment: RuleComment): boolean {
  return source.text.slice(source.text.lastIndexOf("\n", comment.start) + 1, comment.start).trim() !== "";
}

/** Reports the fault in the JSDoc before `node`, if any; `name` is the part a doc may not merely restate. */
export function check(walk: Walk, node: Node, named: { label: string; name: string }): void {
  const { label, name } = named;
  const comment = jsdocOf(walk.source, node);
  const inline =
    comment !== undefined && node["type"] !== NODE_TYPES.parameterProperty && sharesLine(walk.source, comment);
  const fault = inline ? FAULTS.sameLine : docFault(comment?.value, name);
  if (fault !== null) walk.fail(node, label, fault);
}

function methodKey(node: Node): string {
  return `${node["static"] === true ? "static " : ""}${keyName(node["key"])}`;
}
function isSignature(node: Node): boolean {
  return get(node["value"], "type") === NODE_TYPES.emptyBody;
}

/** A class method that is an overload's implementation, or a setter beside its getter: the other carries the doc. */
function isBareClassMember(body: Node[], node: Node): boolean {
  if (node["type"] !== NODE_TYPES.method) return false;
  const siblings = body.filter(
    (other) => other !== node && other["type"] === node["type"] && methodKey(other) === methodKey(node),
  );
  if (node["kind"] === KIND.setter) return siblings.some((other) => other["kind"] === KIND.getter);
  return siblings.some(isSignature) && !isSignature(node);
}

function checkInferred(walk: Walk, node: Node, label: string): void {
  const isFunction =
    node["type"] === NODE_TYPES.method && node["kind"] !== KIND.constructor && node["kind"] !== KIND.setter;
  const isProperty = node["type"] === NODE_TYPES.propertyDefinition || node["type"] === NODE_TYPES.accessorProperty;
  const bodyless = isFunction && isRecord(get(node["value"], "body")) && !isRecord(get(node["value"], "returnType"));
  const untyped = isProperty && !isRecord(node["typeAnnotation"]) && !statesItsType(node["value"]);
  if (bodyless || untyped) walk.fail(node, label, FAULTS.inferred);
}

function checkMember(walk: Walk, node: Node, siblings: Node[]): void {
  const name = keyName(node["id"] ?? node["key"]);
  if (isBareClassMember(siblings, node)) return;
  check(walk, node, { label: `${walk.owner}.${name}`, name });
  checkInferred(walk, node, `${walk.owner}.${name}`);
}

function checkClassBody(walk: Walk, body: Node, visit: (node: Node) => boolean): void {
  const members = nodesOf(body["body"]);
  for (const member of members) {
    if (isHiddenMember(member) || isUnnameable(member)) continue;
    if (MEMBERS.includes(String(member["type"]))) checkMember(walk, member, members);
    const inner = member["type"] === NODE_TYPES.method ? member["value"] : member;
    walkPublic(inner, (node) => node === member || visit(node));
  }
}

/** The visit that checks every member a consumer can see under a declaration, for `walkPublic`. */
export function visitorOf(walk: Walk): (node: Node) => boolean {
  function visit(node: Node): boolean {
    const type = String(node["type"]);
    if (type === NODE_TYPES.classBody) checkClassBody(walk, node, visit);
    if (type === NODE_TYPES.parameterProperty) {
      const name = keyName(node["parameter"]);
      check(walk, node, { label: `${walk.owner}.${name}`, name });
    }
    if (type === NODE_TYPES.conditional)
      for (const part of ["checkType", "trueType", "falseType"]) walkPublic(node[part], visit);

    const signature = SIGNATURES[type];
    if (signature !== undefined) check(walk, node, { label: `${walk.owner}.${signature}`, name: "" });
    if (MEMBERS.includes(type) && !isUnnameable(node)) checkMember(walk, node, []);
    return type !== NODE_TYPES.classBody && type !== NODE_TYPES.conditional && !isUnnameable(node);
  }
  return visit;
}
