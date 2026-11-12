import { AST_TOKEN_TYPES } from "@typescript-eslint/utils";

import { asNode, type SyntaxNode, type SyntaxValue, textOf } from "../syntax-node.ts";
import { docFault } from "./doc-fault.ts";
import { COMPUTED, FAULTS, KIND, MEMBERS, NODE_TYPES, SIGNATURES } from "./public-jsdoc.constants.ts";
import { get, isHiddenMember, nodesOf, walkPublic } from "./public-surface.syntax.ts";
import type { RuleComment } from "./rule.types.ts";
import { statesItsType } from "./states-its-type.ts";

/** The file's text and the comments before a node, as the linter's `SourceCode` gives them. */
export type Source = { text: string; before: (node: SyntaxNode) => readonly RuleComment[] };

/** One public declaration being checked: `owner` is its name, and `fail` reports a fault finishing "… and ". */
export type Walk = { source: Source; owner: string; fail: (node: SyntaxNode, label: string, text: string) => void };

/** True for a key part spelled as written: a name or string, a number or a bigint; false for null, regex or node. */
function isKeyPart(part: SyntaxValue): part is string | number | bigint {
  return typeof part === "string" || typeof part === "number" || typeof part === "bigint";
}

function keyName(key: SyntaxValue): string {
  const label = [get(key, "name"), get(key, "value")].find(isKeyPart);

  return label === undefined ? COMPUTED : String(label);
}

/** A `[name]` key; the key is read first, as an enum member has none and its `computed` getter is deprecated. */
function isUnnameable(node: SyntaxNode): boolean {
  return get(node["key"], "type") === NODE_TYPES.identifier && node["computed"] === true;
}

function jsdocOf(source: Source, node: SyntaxNode): RuleComment | undefined {
  return source
    .before(node)
    .filter((comment) => comment.type === AST_TOKEN_TYPES.Block && comment.value.startsWith("*"))
    .pop();
}

/** TypeScript attaches a member's doc only from comments after a line break, so `{ /** x *\/ a: string }` is no doc. */
function sharesLine(source: Source, comment: RuleComment): boolean {
  const [start] = comment.range;

  return source.text.slice(source.text.lastIndexOf("\n", start) + 1, start).trim() !== "";
}

/** Reports the fault in the JSDoc before `node`, if any; `name` is the part a doc may not merely restate. */
export function check(walk: Walk, node: SyntaxNode, named: { label: string; name: string }): void {
  const { label, name } = named;
  const comment = jsdocOf(walk.source, node);

  const inline =
    comment !== undefined && node["type"] !== NODE_TYPES.parameterProperty && sharesLine(walk.source, comment);

  const fault = inline ? FAULTS.sameLine : docFault(comment?.value, name);

  if (fault !== null) walk.fail(node, label, fault);
}

function methodKey(node: SyntaxNode): string {
  return `${node["static"] === true ? "static " : ""}${keyName(node["key"])}`;
}

function isSignature(node: SyntaxNode): boolean {
  return get(node["value"], "type") === NODE_TYPES.emptyBody;
}

/** A class method that is an overload's implementation, or a setter beside its getter: the other carries the doc. */
function isBareClassMember(body: SyntaxNode[], node: SyntaxNode): boolean {
  if (node["type"] !== NODE_TYPES.method) return false;

  const siblings = body.filter(
    (other) => other !== node && other["type"] === node["type"] && methodKey(other) === methodKey(node),
  );

  if (node["kind"] === KIND.setter) return siblings.some((other) => other["kind"] === KIND.getter);

  return siblings.some(isSignature) && !isSignature(node);
}

function checkInferred(walk: Walk, node: SyntaxNode, label: string): void {
  const isFunction =
    node["type"] === NODE_TYPES.method && node["kind"] !== KIND.constructor && node["kind"] !== KIND.setter;

  const isProperty = node["type"] === NODE_TYPES.propertyDefinition || node["type"] === NODE_TYPES.accessorProperty;
  const hasBody = asNode(get(node["value"], "body")) !== null;
  const bodyless = isFunction && hasBody && asNode(get(node["value"], "returnType")) === null;
  const untyped = isProperty && asNode(node["typeAnnotation"]) === null && !statesItsType(node["value"]);

  if (bodyless || untyped) walk.fail(node, label, FAULTS.inferred);
}

function checkMember(walk: Walk, node: SyntaxNode, siblings: SyntaxNode[]): void {
  const name = keyName(node["id"] ?? node["key"]);

  if (isBareClassMember(siblings, node)) return;
  check(walk, node, { label: `${walk.owner}.${name}`, name });
  checkInferred(walk, node, `${walk.owner}.${name}`);
}

function checkClassBody(walk: Walk, body: SyntaxNode, visit: (node: SyntaxNode) => boolean): void {
  const members = nodesOf(body["body"]);

  for (const member of members) {
    if (isHiddenMember(member) || isUnnameable(member)) continue;

    if (MEMBERS.includes(textOf(get(member, "type")))) checkMember(walk, member, members);
    const inner = member["type"] === NODE_TYPES.method ? member["value"] : member;
    walkPublic(inner, (node) => node === member || visit(node));
  }
}

/** Whether `type` is a signature kind `SIGNATURES` labels. */
function isSignatureKind(type: string): type is keyof typeof SIGNATURES {
  return Object.hasOwn(SIGNATURES, type);
}

/** The visit that checks every member a consumer can see under a declaration, for `walkPublic`. */
export function visitorOf(walk: Walk): (node: SyntaxNode) => boolean {
  function visit(node: SyntaxNode): boolean {
    const type = textOf(get(node, "type"));

    if (type === NODE_TYPES.classBody) checkClassBody(walk, node, visit);

    if (type === NODE_TYPES.parameterProperty) {
      const name = keyName(node["parameter"]);
      check(walk, node, { label: `${walk.owner}.${name}`, name });
    }

    if (type === NODE_TYPES.conditional)
      for (const part of ["checkType", "trueType", "falseType"]) walkPublic(node[part], visit);

    if (isSignatureKind(type)) check(walk, node, { label: `${walk.owner}.${SIGNATURES[type]}`, name: "" });

    if (MEMBERS.includes(type) && !isUnnameable(node)) checkMember(walk, node, []);

    return type !== NODE_TYPES.classBody && type !== NODE_TYPES.conditional && !isUnnameable(node);
  }

  return visit;
}
