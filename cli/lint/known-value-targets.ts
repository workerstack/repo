/**
 * Ported from anti-slop (MIT, see anti-slop.LICENSE): `classifyWideningTarget` of `src/shared/dictionary-types.ts`.
 * Names the broad or anonymous kind of type a known value is written into: `unknown`, `object`, an open dictionary
 * (a `Record` or mapped type with a `string`, `number`, `symbol` or `PropertyKey` key, or an index signature), an
 * anonymous object literal type, or a generic alias that opens into a dictionary.
 */
import { AST_NODE_TYPES, type TSESTree } from "@typescript-eslint/utils";

import {
  expandAlias,
  isBuiltIn,
  isUnappliedReferenceTo,
  referenceName,
  type TypeEnvironment,
  unwrapped,
  type Walk,
} from "./dictionary-walk.ts";
import { visibleTypeAlias } from "./type-aliases.ts";

type TypeNode = TSESTree.TypeNode;

/** The kind of type a known value is widened into, as the rule's message names it. */
export type WideningTarget = "anonymous object" | "generic container" | "object" | "open dictionary" | "unknown";

/** The built-ins whose first argument is the type they stand for. */
const TRANSPARENT_WRAPPERS: readonly string[] = ["NonNullable", "Partial", "Readonly", "Required"];

const RECORD: readonly string[] = ["Record"];

const PROPERTY_KEY: readonly string[] = ["PropertyKey"];

const BROAD_KEYS: readonly string[] = [
  AST_NODE_TYPES.TSNumberKeyword,
  AST_NODE_TYPES.TSStringKeyword,
  AST_NODE_TYPES.TSSymbolKeyword,
];

/** A walk from the top of a written type, with no alias expanded and no substitution in force. */
function freshWalk(environment: TypeEnvironment): Walk {
  return { aliases: new Set(), environment, substitutions: new Map() };
}

/** The kind `type` is by itself when it is a keyword, null when it is neither `unknown` nor `object`. */
function keywordKind(type: TypeNode): WideningTarget | null {
  if (type.type === AST_NODE_TYPES.TSUnknownKeyword) return "unknown";

  return type.type === AST_NODE_TYPES.TSObjectKeyword ? "object" : null;
}

/** Whether `literal` has an index signature, which opens it to any key. */
function hasIndexSignature(literal: TSESTree.TSTypeLiteral): boolean {
  return literal.members.some((member) => member.type === AST_NODE_TYPES.TSIndexSignature);
}

/** Whether the key type `type` admits every string, number or symbol, through unions, parameters and aliases. */
function isBroadKey(type: TypeNode, walk: Walk): boolean {
  const current = unwrapped(type);

  if (BROAD_KEYS.includes(current.type)) return true;

  if (current.type === AST_NODE_TYPES.TSUnionType) return current.types.some((member) => isBroadKey(member, walk));

  return current.type === AST_NODE_TYPES.TSTypeReference && isBroadKeyReference(current, walk);
}

/** Whether the key `reference` names a broad key: a parameter bound to one, `PropertyKey`, or a plain alias of one. */
function isBroadKeyReference(reference: TSESTree.TSTypeReference, walk: Walk): boolean {
  const name = referenceName(reference);

  if (name === null) return false;
  const substitution = walk.substitutions.get(name);

  if (substitution !== undefined && !isUnappliedReferenceTo(substitution, name)) return isBroadKey(substitution, walk);

  if (isBuiltIn(reference, PROPERTY_KEY, walk.environment)) return true;
  const alias = visibleTypeAlias(name, reference, walk.environment.typeAliases);
  const next = (alias?.typeParameters ?? undefined) === undefined ? expandAlias(reference, name, walk) : null;

  return next !== null && isBroadKey(next.type, next.walk);
}

/** Whether the `Record` `reference` has a broad key, or none at all. */
function hasBroadRecordKey(reference: TSESTree.TSTypeReference, walk: Walk): boolean {
  const [key] = reference.typeArguments?.params ?? [];

  return key === undefined || isBroadKey(key, walk);
}

/** The broad kind a built-in wrapper or `Record` reference is, undefined when `reference` is neither. */
function builtInKind(
  reference: TSESTree.TSTypeReference,
  walk: Walk,
  classify: (type: TypeNode) => WideningTarget | null,
): WideningTarget | null | undefined {
  if (isBuiltIn(reference, TRANSPARENT_WRAPPERS, walk.environment)) {
    const [operand] = reference.typeArguments?.params ?? [];

    return operand === undefined ? null : classify(operand);
  }

  if (!isBuiltIn(reference, RECORD, walk.environment)) return undefined;

  return hasBroadRecordKey(reference, walk) ? "open dictionary" : null;
}

/** The broad kind `type` is inside an alias: only an open dictionary, `unknown` or `object`, never an anonymous one. */
function aliasKind(type: TypeNode, walk: Walk): WideningTarget | null {
  const current = unwrapped(type);
  const keyword = keywordKind(current);

  if (keyword !== null) return keyword;

  if (current.type === AST_NODE_TYPES.TSTypeLiteral) return hasIndexSignature(current) ? "open dictionary" : null;

  if (current.type === AST_NODE_TYPES.TSMappedType)
    return isBroadKey(current.constraint, walk) ? "open dictionary" : null;

  return current.type === AST_NODE_TYPES.TSTypeReference ? aliasReferenceKind(current, walk) : null;
}

/** The broad kind the reference `reference` stands for inside an alias, through parameters, built-ins and aliases. */
function aliasReferenceKind(reference: TSESTree.TSTypeReference, walk: Walk): WideningTarget | null {
  const name = referenceName(reference);

  if (name === null) return null;
  const substitution = walk.substitutions.get(name);

  if (substitution !== undefined)
    return isUnappliedReferenceTo(substitution, name) ? null : aliasKind(substitution, walk);
  const builtIn = builtInKind(reference, walk, (operand) => aliasKind(operand, walk));

  if (builtIn !== undefined) return builtIn;
  const next = expandAlias(reference, name, walk);

  return next === null ? null : aliasKind(next.type, next.walk);
}

/** The broad kind the visible alias `reference` names; a generic one that opens into a dictionary is a container. */
function referenceKind(reference: TSESTree.TSTypeReference, name: string, walk: Walk): WideningTarget | null {
  const builtIn = builtInKind(reference, walk, (operand) => classifyWideningTarget(operand, walk.environment));

  if (builtIn !== undefined) return builtIn;
  const alias = visibleTypeAlias(name, reference, walk.environment.typeAliases);
  const next = expandAlias(reference, name, walk);

  if (alias === null || next === null) return null;
  const kind = aliasKind(next.type, next.walk);

  if ((alias.typeParameters ?? undefined) === undefined) return kind;

  return kind === "open dictionary" ? "generic container" : null;
}

/**
 * The broad or anonymous kind of the written type `type`, or null when it is a named, closed or otherwise informative
 * type that keeps what was known of a value.
 */
export function classifyWideningTarget(type: TypeNode, environment: TypeEnvironment): WideningTarget | null {
  const current = unwrapped(type);
  const keyword = keywordKind(current);

  if (keyword !== null) return keyword;

  if (current.type === AST_NODE_TYPES.TSTypeLiteral) {
    if (hasIndexSignature(current)) return "open dictionary";

    return current.members.length > 0 ? "anonymous object" : null;
  }

  if (current.type === AST_NODE_TYPES.TSMappedType) return "open dictionary";
  const name = current.type === AST_NODE_TYPES.TSTypeReference ? referenceName(current) : null;

  return current.type === AST_NODE_TYPES.TSTypeReference && name !== null
    ? referenceKind(current, name, freshWalk(environment))
    : null;
}
