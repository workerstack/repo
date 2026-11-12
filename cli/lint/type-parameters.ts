/**
 * Ported from anti-slop (MIT, see anti-slop.LICENSE): `src/shared/lexical-type-parameters.ts`. The type binders in
 * scope at a node, which shadow a module type alias of the same name.
 */
import { AST_NODE_TYPES, type TSESLint, type TSESTree } from "@typescript-eslint/utils";

import { isRecord } from "../json.ts";

/** The linter's child keys per node type, as `context.sourceCode.visitorKeys` hands them to a rule. */
export type VisitorKeys = TSESLint.SourceCode.VisitorKeys;

/** Whether a field the visitor keys name holds a node, rather than null or a missing optional child. */
function isNode(value: unknown): value is TSESTree.Node {
  return isRecord(value) && typeof value["type"] === "string";
}

/** The child nodes of `node`, read through the fields its visitor keys name; a type with no keys has none. */
export function childNodes(node: TSESTree.Node, visitorKeys: VisitorKeys): TSESTree.Node[] {
  const keys = new Set(visitorKeys[node.type]);
  const fields: [string, unknown][] = Object.entries(node);

  return fields
    .filter(([key]) => keys.has(key))
    .flatMap(([, value]) => [value].flat())
    .filter(isNode);
}

/** Adds every `infer X` binder under `node` to `names`. */
function collectInferNames(node: TSESTree.Node, visitorKeys: VisitorKeys, names: Set<string>): void {
  if (node.type === AST_NODE_TYPES.TSInferType) names.add(node.typeParameter.name.name);

  for (const child of childNodes(node, visitorKeys)) collectInferNames(child, visitorKeys, names);
}

/** One step of the walk up from a use: the node, the child of it the walk came from, and where names go. */
type Step = { owner: TSESTree.Node; descendant: TSESTree.Node; names: Set<string> };

/** Adds the binders `owner` puts in scope for its child `descendant` to `names`. */
function collectOwnNames({ owner, descendant, names }: Step, visitorKeys: VisitorKeys): void {
  if ("typeParameters" in owner)
    for (const parameter of owner.typeParameters?.params ?? []) names.add(parameter.name.name);
  const isMapped = owner.type === AST_NODE_TYPES.TSMappedType;

  if (isMapped && (descendant === owner.nameType || descendant === owner.typeAnnotation)) names.add(owner.key.name);

  if (owner.type === AST_NODE_TYPES.TSConditionalType && descendant === owner.trueType)
    collectInferNames(owner.extendsType, visitorKeys, names);
}

/** The type parameter, mapped key and `infer` names in scope at `node`, any of which shadows a module alias. */
export function lexicalTypeParameterNames(node: TSESTree.Node, visitorKeys: VisitorKeys): ReadonlySet<string> {
  const names = new Set<string>();
  let descendant = node;
  let current = node;

  while (current.type !== AST_NODE_TYPES.Program) {
    collectOwnNames({ descendant, names, owner: current }, visitorKeys);
    descendant = current;
    current = current.parent;
  }

  return names;
}
