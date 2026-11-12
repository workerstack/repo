/** What a declaration shows a consumer, read off parser output: shared by the module reader and the reference walk. */
import { asNode, isSyntaxList, type ParserOutput, type SyntaxNode, type SyntaxValue, textOf } from "../syntax-node.ts";
import {
  BODY,
  DECLARATION,
  DEFAULT,
  FUNCTIONS,
  HIDDEN_ACCESS,
  NAMESPACE,
  NODE,
  PARENT,
  REFERENCE_KEYS,
  RIGHT,
  TYPED_INITS,
  VALUE_HOLDERS,
} from "./public-surface.constants.ts";
import type { Reference } from "./public-surface.types.ts";

/** `value[key]`, or undefined when `value` is no node. */
export function get(value: SyntaxValue, key: string): SyntaxValue {
  return asNode(value)?.[key];
}

/** The nodes in `value`, which is one node, a list of them, or nothing; a parser's typed output reads the same. */
export function nodesOf(value: SyntaxValue | ParserOutput): SyntaxNode[] {
  return [value]
    .flat()
    .map(asNode)
    .filter((node) => node !== null);
}

/** The name an identifier or a string literal carries. */
export function nameOf(node: SyntaxValue): string {
  return textOf(get(node, "name") ?? get(node, "value"));
}

/** The text of the `from "…"` of an import or export statement. */
export function sourceText(statement: SyntaxNode): string {
  return textOf(get(get(statement, "source"), "value"));
}

export function isHiddenMember(node: SyntaxNode): boolean {
  const access = textOf(get(node, "accessibility"));

  return HIDDEN_ACCESS.includes(access) || get(node["key"], "type") === NODE.privateIdentifier;
}

function skipsChild(node: SyntaxNode, key: string): boolean {
  const type = textOf(get(node, "type"));

  if (key === PARENT) return true;

  if (FUNCTIONS.includes(type)) return key === BODY;

  if (type === NODE.assignmentPattern) return key === RIGHT;

  if (!VALUE_HOLDERS.includes(type)) return false;
  const value = type === NODE.declarator ? "init" : "value";

  return key === value && !TYPED_INITS.includes(textOf(get(node[key], "type")));
}

/** Walks what a declaration shows a consumer: no function body, no private member, no untyped initializer. */
export function walkPublic(node: SyntaxValue, visit: (node: SyntaxNode) => boolean): void {
  if (isSyntaxList(node)) {
    for (const child of node) walkPublic(child, visit);

    return;
  }

  const found = asNode(node);

  if (found === null || typeof found["type"] !== "string" || isHiddenMember(found)) return;

  if (!visit(found)) return;

  for (const [key, value] of Object.entries(found)) if (!skipsChild(found, key)) walkPublic(value, visit);
}

/** The declaration an export statement carries (null for one that carries none), or the statement itself. */
export function declarationOf(statement: SyntaxNode): SyntaxNode | null {
  if (statement["type"] !== NODE.exportNamed && statement["type"] !== NODE.exportDefault) return statement;

  return asNode(statement["declaration"]);
}

/** The top-level names a statement declares; an anonymous default declaration declares `default`. */
export function declaredNames(statement: SyntaxNode): string[] {
  const declaration = declarationOf(statement);

  if (declaration === null) return [];

  if (declaration["type"] === NODE.variable) {
    return nodesOf(declaration["declarations"])
      .map((declarator) => declarator["id"])
      .filter((id) => get(id, "type") === NODE.identifier)
      .map(nameOf);
  }

  if (!DECLARATION.test(textOf(get(declaration, "type"))) || declaration["id"] === undefined) return [];

  if (declaration["type"] === NODE.module) return [];

  return [declaration["id"] === null ? DEFAULT : nameOf(declaration["id"])];
}

/** The node type of the form in `statement` the walk cannot follow, or null when it can follow it. */
export function unknownForm(statement: SyntaxNode): string | null {
  if (statement["type"] === NODE.exportAssignment) return NODE.exportAssignment;
  const declaration = statement["type"] === NODE.exportNamed ? declarationOf(statement) : null;
  const type = get(declaration, "type");

  if (type === NODE.module || type === NODE.importEquals) return type;

  if (type !== NODE.variable) return null;

  const odd = nodesOf(get(declaration, "declarations"))
    .map((declarator) => declarator["id"])
    .find((id) => get(id, "type") !== NODE.identifier);

  return odd === undefined ? null : textOf(get(odd, "type"));
}

/** The names at the start of a `a.b.c` chain, root first; empty when the chain starts at anything else. */
function chainOf(node: SyntaxValue): string[] {
  const type = get(node, "type");

  if (type === NODE.identifier) return [nameOf(node)];

  if (type !== NODE.qualifiedName && type !== NODE.member) return [];
  const head = chainOf(get(node, "left") ?? get(node, "object"));

  return head.length === 0 ? head : [...head, nameOf(get(node, "right") ?? get(node, "property"))];
}

/** Whether `type` is a node type `REFERENCE_KEYS` says where to find the name in. */
function isReferenceType(type: string): type is keyof typeof REFERENCE_KEYS {
  return Object.hasOwn(REFERENCE_KEYS, type);
}

/** The names the type of `statement`'s declaration mentions, minus any a type parameter of its own shadows. */
export function referencesOf(statement: SyntaxNode): Reference[] {
  const references: Reference[] = [];
  const shadowed = new Set<string>();
  walkPublic(declarationOf(statement), (node) => {
    if (node["type"] === NODE.typeParameter) shadowed.add(nameOf(node["name"]));

    if (node["type"] === NODE.importType)
      references.push({ name: chainOf(node["qualifier"])[0] ?? NAMESPACE, source: sourceText(node) });

    const type = textOf(get(node, "type"));
    const chain = isReferenceType(type) ? chainOf(node[REFERENCE_KEYS[type]]) : [];

    if (chain[0] !== undefined) references.push({ member: chain[1] ?? null, name: chain[0], source: null });

    return true;
  });

  return references.filter((reference) => reference.source !== null || !shadowed.has(reference.name));
}
