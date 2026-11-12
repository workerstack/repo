/**
 * The type-syntax predicates of `repo/no-widen-then-assert`: which annotations widen, and which assertions narrow
 * back. Ported from anti-slop (MIT, see anti-slop.LICENSE): `src/rules/no-widen-then-assert.ts`.
 */
import { AST_NODE_TYPES, type TSESLint, type TSESTree } from "@typescript-eslint/utils";

import { PROPERTY_KEY, READONLY, RECORD, RECORD_ARITY } from "./widen-types.constants.ts";

/** How a type widens: to `unknown` or `any`, to `object`, or to a record of unknown values. */
export type BroadTypeKind = "top" | "object" | "record";

const KEY_KEYWORDS: readonly string[] = ["TSStringKeyword", "TSNumberKeyword", "TSSymbolKeyword"];
const OBJECT_TYPES: readonly string[] = [
  "TSArrayType",
  "TSConstructorType",
  "TSFunctionType",
  "TSMappedType",
  "TSObjectKeyword",
  "TSTupleType",
];
const WHITESPACE = /\s+/gu;

/** The name of a type reference written as a plain identifier, as `Record` in `Record<K, V>`. */
function referenceName(type: TSESTree.TSTypeReference): string | null {
  return type.typeName.type === AST_NODE_TYPES.Identifier ? type.typeName.name : null;
}

/** The type arguments of `type`, none when it has no `<…>`. */
function argumentsOf(type: TSESTree.TSTypeReference): TSESTree.TypeNode[] {
  return type.typeArguments?.params ?? [];
}

function isUnknownOrAny(type: TSESTree.TypeNode | undefined): boolean {
  return type?.type === AST_NODE_TYPES.TSUnknownKeyword || type?.type === AST_NODE_TYPES.TSAnyKeyword;
}

/** `string`, `number`, `symbol`, `PropertyKey` or a union of them: a key type that admits any key. */
function isBroadKey(type: TSESTree.TypeNode | undefined): boolean {
  if (type === undefined) return false;
  if (KEY_KEYWORDS.includes(type.type)) return true;
  if (type.type === AST_NODE_TYPES.TSUnionType) return type.types.every(isBroadKey);
  return type.type === AST_NODE_TYPES.TSTypeReference && referenceName(type) === PROPERTY_KEY;
}

/** `{ [key: K]: unknown }` with K a broad key. */
function isBroadIndexLiteral(type: TSESTree.TSTypeLiteral): boolean {
  const [member] = type.members;
  if (type.members.length !== 1 || member?.type !== AST_NODE_TYPES.TSIndexSignature) return false;
  const [parameter] = member.parameters;
  const key = parameter?.type === AST_NODE_TYPES.Identifier ? parameter.typeAnnotation?.typeAnnotation : undefined;
  return member.parameters.length === 1 && isBroadKey(key) && isUnknownOrAny(member.typeAnnotation?.typeAnnotation);
}

/** `Record<K, unknown>` with K a broad key, an index literal of the same, or either under `Readonly<…>`. */
function isBroadRecord(type: TSESTree.TypeNode): boolean {
  if (type.type === AST_NODE_TYPES.TSTypeLiteral) return isBroadIndexLiteral(type);
  if (type.type !== AST_NODE_TYPES.TSTypeReference) return false;
  const typeArguments = argumentsOf(type);
  const [key, value] = typeArguments;
  if (referenceName(type) === READONLY) return key !== undefined && isBroadRecord(key);
  const isRecord = referenceName(type) === RECORD && typeArguments.length === RECORD_ARITY;
  return isRecord && isBroadKey(key) && isUnknownOrAny(value);
}

/** How `type` widens a value, or null when it keeps some evidence of the value's shape. */
export function broadTypeKind(type: TSESTree.TypeNode): BroadTypeKind | null {
  if (isUnknownOrAny(type)) return "top";
  if (type.type === AST_NODE_TYPES.TSObjectKeyword) return "object";
  return isBroadRecord(type) ? "record" : null;
}

/** The source text of `type` with all whitespace dropped. */
function compactText(sourceCode: Readonly<TSESLint.SourceCode>, type: TSESTree.TypeNode): string {
  return sourceCode.getText(type).replaceAll(WHITESPACE, "");
}

/** Whether `left` and `right` are the same type text once whitespace is dropped. */
export function typesHaveSameSyntax(
  sourceCode: Readonly<TSESLint.SourceCode>,
  left: TSESTree.TypeNode | null,
  right: TSESTree.TypeNode,
): boolean {
  return left !== null && compactText(sourceCode, left) === compactText(sourceCode, right);
}

/** Whether every value of `type` is an object: arrays, functions, tuples, mapped and non-empty literal types. */
export function isDefinitelyObjectType(type: TSESTree.TypeNode): boolean {
  if (OBJECT_TYPES.includes(type.type)) return true;
  if (type.type === AST_NODE_TYPES.TSTypeLiteral) return type.members.length > 0;
  if (type.type === AST_NODE_TYPES.TSIntersectionType) return type.types.every(isDefinitelyObjectType);
  return (
    type.type === AST_NODE_TYPES.TSTypeOperator &&
    type.operator === "readonly" &&
    type.typeAnnotation !== undefined &&
    isDefinitelyObjectType(type.typeAnnotation)
  );
}

/**
 * Whether `type` is a record narrower than a broad one: a literal with a named member, or `Record<K, V>` with V
 * known.
 */
export function isDefinitelyNarrowerRecordType(type: TSESTree.TypeNode): boolean {
  if (type.type === AST_NODE_TYPES.TSTypeLiteral)
    return type.members.some((member) => member.type !== AST_NODE_TYPES.TSIndexSignature);
  if (type.type !== AST_NODE_TYPES.TSTypeReference) return false;
  const [first, value] = argumentsOf(type);
  if (referenceName(type) === READONLY) return first !== undefined && isDefinitelyNarrowerRecordType(first);
  return referenceName(type) === RECORD && argumentsOf(type).length === RECORD_ARITY && !isUnknownOrAny(value);
}
