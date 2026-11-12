/**
 * Ported from anti-slop (MIT, see anti-slop.LICENSE): `src/shared/dictionary-types.ts` through
 * `classifyUnsafeDictionary`. Finds a dictionary's value types (of a `Record`, an index signature or a mapped type,
 * through `Readonly`-like wrappers, `Pick`, `Omit` and visible local aliases) and names the escape hatch a value type
 * is: `unknown`, `any`, `object`, `{}` or a union holding one.
 */
import { AST_NODE_TYPES, type TSESTree } from "@typescript-eslint/utils";

import {
  expandAlias,
  isBuiltIn,
  isUnappliedReferenceTo,
  referenceName,
  unwrapped,
  type Walk,
} from "./dictionary-walk.ts";

type TypeNode = TSESTree.TypeNode;

/** A dictionary's value type and the substitutions in force where it was written. */
type ValueType = { readonly substitutions: Walk["substitutions"]; readonly type: TypeNode };

/** The escape hatch a dictionary's value type is, as the rule's message names it. */
export type UnsafeValue = "any" | "empty-object" | "object" | "union" | "unknown";

/** The built-ins whose first argument is the type they stand for, as far as its values go. */
const TRANSPARENT_WRAPPERS: readonly string[] = ["NonNullable", "Partial", "Readonly", "Required"];

/** The built-ins whose first argument is the dictionary whose values they keep. */
const DICTIONARY_WRAPPERS: readonly string[] = [...TRANSPARENT_WRAPPERS, "Omit", "Pick"];

const RECORD: readonly string[] = ["Record"];

/** The escape hatch the keyword type `type` is by itself, if any. */
function keywordValue(type: TypeNode): UnsafeValue | undefined {
  if (type.type === AST_NODE_TYPES.TSAnyKeyword) return "any";

  if (type.type === AST_NODE_TYPES.TSObjectKeyword) return "object";

  return type.type === AST_NODE_TYPES.TSUnknownKeyword ? "unknown" : undefined;
}

/** Whether `member` is an optional `never` property, which no value can fill. */
function isEmptyMember(member: TSESTree.TypeElement): boolean {
  const annotation =
    member.type === AST_NODE_TYPES.TSPropertySignature && member.optional
      ? (member.typeAnnotation ?? undefined)
      : undefined;

  return annotation !== undefined && unwrapped(annotation.typeAnnotation).type === AST_NODE_TYPES.TSNeverKeyword;
}

/** Whether the interface `declarations` merge into is `{}`: one declaration, no heritage, only empty members. */
function isEmptyInterface(declarations: readonly TSESTree.TSInterfaceDeclaration[]): boolean {
  const [only, ...rest] = declarations;

  return only !== undefined && rest.length === 0 && only.extends.length === 0 && only.body.body.every(isEmptyMember);
}

/** The escape hatch an intersection is: `any` when a member is, else the first one when every member is one. */
function intersectionValue(type: TSESTree.TSIntersectionType, walk: Walk): UnsafeValue | undefined {
  const values = type.types.map((member) => unsafeValueOf(member, walk));

  if (values.includes("any")) return "any";

  return values.includes(undefined) ? undefined : values[0];
}

/** The escape hatch the interface or alias `reference` names is, if any. */
function declaredValue(reference: TSESTree.TSTypeReference, name: string, walk: Walk): UnsafeValue | undefined {
  const interfaces = walk.environment.interfaces.get(name);

  if (interfaces !== undefined) return isEmptyInterface(interfaces) ? "empty-object" : undefined;
  const next = expandAlias(reference, name, walk);

  return next === null ? undefined : unsafeValueOf(next.type, next.walk);
}

/** The escape hatch `reference` stands for: through a wrapper, a type parameter, an interface or an alias. */
function referenceValue(reference: TSESTree.TSTypeReference, walk: Walk): UnsafeValue | undefined {
  const name = referenceName(reference);

  if (name === null) return undefined;
  const [operand] = reference.typeArguments?.params ?? [];

  if (isBuiltIn(reference, TRANSPARENT_WRAPPERS, walk.environment))
    return operand === undefined ? undefined : unsafeValueOf(operand, walk);
  const substitution = walk.substitutions.get(name);

  if (substitution === undefined) return declaredValue(reference, name, walk);

  return isUnappliedReferenceTo(substitution, name) ? undefined : unsafeValueOf(substitution, walk);
}

/** The escape hatch `type` is, or undefined when it is a concrete value type. */
function unsafeValueOf(type: TypeNode, walk: Walk): UnsafeValue | undefined {
  const current = unwrapped(type);
  const keyword = keywordValue(current);

  if (keyword !== undefined) return keyword;

  if (current.type === AST_NODE_TYPES.TSTypeLiteral)
    return current.members.every(isEmptyMember) ? "empty-object" : undefined;

  if (current.type === AST_NODE_TYPES.TSUnionType)
    return current.types.some((member) => unsafeValueOf(member, walk) !== undefined) ? "union" : undefined;

  if (current.type === AST_NODE_TYPES.TSIntersectionType) return intersectionValue(current, walk);

  return current.type === AST_NODE_TYPES.TSTypeReference ? referenceValue(current, walk) : undefined;
}

/** The value type of `member` when it is a typed index signature. */
function indexValueTypes(member: TSESTree.TypeElement, walk: Walk): ValueType[] {
  const annotation = member.type === AST_NODE_TYPES.TSIndexSignature ? (member.typeAnnotation ?? undefined) : undefined;

  return annotation === undefined ? [] : [{ substitutions: walk.substitutions, type: annotation.typeAnnotation }];
}

/** The value types of the built-in `reference`, a `Record` or a wrapper's operand, or null when it is no built-in. */
function builtInValueTypes(reference: TSESTree.TSTypeReference, walk: Walk): readonly ValueType[] | null {
  const [source, value] = reference.typeArguments?.params ?? [];

  if (isBuiltIn(reference, DICTIONARY_WRAPPERS, walk.environment))
    return source === undefined ? [] : dictionaryValueTypes(source, walk);

  if (!isBuiltIn(reference, RECORD, walk.environment)) return null;

  return value === undefined ? [] : [{ substitutions: walk.substitutions, type: value }];
}

/** The value types of the dictionary `reference` stands for: a type parameter, a built-in or an alias. */
function referenceValueTypes(reference: TSESTree.TSTypeReference, walk: Walk): readonly ValueType[] {
  const name = referenceName(reference);

  if (name === null) return [];
  const substitution = walk.substitutions.get(name);

  if (substitution !== undefined)
    return isUnappliedReferenceTo(substitution, name) ? [] : dictionaryValueTypes(substitution, walk);
  const builtIn = builtInValueTypes(reference, walk);

  if (builtIn !== null) return builtIn;
  const next = expandAlias(reference, name, walk);

  return next === null ? [] : dictionaryValueTypes(next.type, next.walk);
}

/** The value types of the dictionary `type` is, or none when it is no dictionary. */
function dictionaryValueTypes(type: TypeNode, walk: Walk): readonly ValueType[] {
  const current = unwrapped(type);

  if (current.type === AST_NODE_TYPES.TSTypeLiteral)
    return current.members.flatMap((member) => indexValueTypes(member, walk));

  if (current.type === AST_NODE_TYPES.TSMappedType) {
    const value = current.typeAnnotation ?? undefined;

    return value === undefined ? [] : [{ substitutions: walk.substitutions, type: value }];
  }

  return current.type === AST_NODE_TYPES.TSTypeReference ? referenceValueTypes(current, walk) : [];
}

/** The escape hatch the value type `type`, as an index signature's, is, or undefined when it is concrete. */
export function classifyUnsafeDictionaryValue(
  type: TypeNode,
  environment: Walk["environment"],
): UnsafeValue | undefined {
  return unsafeValueOf(type, { aliases: new Set(), environment, substitutions: new Map() });
}

/** The escape hatch the first unsafe value type of the dictionary `type` is, or undefined when it has none. */
export function classifyUnsafeDictionary(type: TypeNode, environment: Walk["environment"]): UnsafeValue | undefined {
  for (const { substitutions, type: value } of dictionaryValueTypes(type, {
    aliases: new Set(),
    environment,
    substitutions: new Map(),
  })) {
    const unsafe = unsafeValueOf(value, { aliases: new Set(), environment, substitutions });

    if (unsafe !== undefined) return unsafe;
  }

  return undefined;
}
