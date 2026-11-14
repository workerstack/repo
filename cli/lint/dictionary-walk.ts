/**
 * Ported from anti-slop (MIT, see anti-slop.LICENSE): the alias and built-in resolution of
 * `src/shared/dictionary-types.ts`. A dictionary walk follows type references through the type parameters, local
 * aliases and unshadowed built-ins visible at them.
 */
import { AST_NODE_TYPES, ESLintUtils, type TSESTree } from "@typescript-eslint/utils";

import {
  typeAliasEnvironmentOf,
  hasVisibleTypeBinding,
  visibleTypeAlias,
  type TypeAliasEnvironment,
} from "./type-aliases.ts";
import type { VisitorKeys } from "./type-parameters.ts";

type TypeNode = TSESTree.TypeNode;

/** The type each type parameter stands for, by name, inside the aliases being expanded. */
type Substitutions = ReadonlyMap<string, TypeNode>;

/** A program's top-level interfaces by name and its type aliases; build it once, in the `Program` visitor. */
export type TypeEnvironment = {
  readonly interfaces: ReadonlyMap<string, readonly TSESTree.TSInterfaceDeclaration[]>;
  readonly typeAliases: TypeAliasEnvironment;
};

/** Where a walk stands: the program's environment, the substitutions in force and the aliases being expanded. */
export type Walk = {
  readonly aliases: ReadonlySet<string>;
  readonly environment: TypeEnvironment;
  readonly substitutions: Substitutions;
};

/** The declaration `statement` holds past an `export`, or null for `export { … }`. */
function declaredStatement(statement: TSESTree.ProgramStatement): TSESTree.Node | null {
  return statement.type === AST_NODE_TYPES.ExportNamedDeclaration ||
    statement.type === AST_NODE_TYPES.ExportDefaultDeclaration
    ? statement.declaration
    : statement;
}

/** The type environment of `program`. */
export function createTypeEnvironment(program: TSESTree.Program, visitorKeys: VisitorKeys): TypeEnvironment {
  const interfaces = new Map<string, TSESTree.TSInterfaceDeclaration[]>();

  for (const statement of program.body) {
    const declaration = declaredStatement(statement);

    if (declaration?.type !== AST_NODE_TYPES.TSInterfaceDeclaration) continue;
    interfaces.set(declaration.id.name, [...(interfaces.get(declaration.id.name) ?? []), declaration]);
  }

  return { interfaces, typeAliases: typeAliasEnvironmentOf(program, visitorKeys) };
}

/** The name `reference` uses, or null for a qualified name such as `Namespace.Type`. */
export function referenceName(reference: TSESTree.TSTypeReference): string | null {
  return reference.typeName.type === AST_NODE_TYPES.Identifier ? reference.typeName.name : null;
}

/** Whether `reference` names one of the built-ins `names`, which no local declaration or binder shadows there. */
export function isBuiltIn(
  reference: TSESTree.TSTypeReference,
  names: readonly string[],
  environment: TypeEnvironment,
): boolean {
  const name = referenceName(reference);

  return name !== null && names.includes(name) && !hasVisibleTypeBinding(name, reference, environment.typeAliases);
}

/** `type` past any `readonly` operator. */
export function unwrapped(type: TypeNode): TypeNode {
  if (type.type !== AST_NODE_TYPES.TSTypeOperator || type.operator !== "readonly") return type;

  return unwrapped(ESLintUtils.nullThrows(type.typeAnnotation, "a readonly operator has an operand"));
}

/** Whether `type` is a bare reference to the type parameter `name`, which a substitution maps to itself. */
export function isUnappliedReferenceTo(type: TypeNode, name: string): boolean {
  const current = unwrapped(type);

  return (
    current.type === AST_NODE_TYPES.TSTypeReference &&
    referenceName(current) === name &&
    (current.typeArguments ?? undefined) === undefined
  );
}

/** `type` with a type parameter reference followed through `substitutions` to what it stands for. */
function substituted(type: TypeNode, substitutions: Substitutions, followed: ReadonlySet<string>): TypeNode {
  const current = unwrapped(type);
  const name = current.type === AST_NODE_TYPES.TSTypeReference ? referenceName(current) : null;

  if (name === null || followed.has(name)) return type;
  const next = substitutions.get(name);

  return next === undefined ? type : substituted(next, substitutions, new Set([...followed, name]));
}

/** The substitutions in force inside `alias` as `reference` instantiates it, or null when an argument is missing. */
function aliasSubstitutions(
  alias: TSESTree.TSTypeAliasDeclaration,
  reference: TSESTree.TSTypeReference,
  base: Substitutions,
): Substitutions | null {
  const explicit = reference.typeArguments?.params ?? [];
  const next = new Map(base);

  for (const [index, parameter] of (alias.typeParameters?.params ?? []).entries()) {
    const argument = explicit[index] ?? parameter.default ?? undefined;

    if (argument === undefined) return null;
    next.set(parameter.name.name, substituted(argument, next, new Set()));
  }

  return next;
}

/** What the alias `name` at `reference` stands for and the walk inside it, or null when no alias expands there. */
export function expandAlias(
  reference: TSESTree.TSTypeReference,
  name: string,
  walk: Walk,
): { readonly type: TypeNode; readonly walk: Walk } | null {
  const alias = visibleTypeAlias(name, reference, walk.environment.typeAliases);

  if (alias === null || walk.aliases.has(name)) return null;
  const substitutions = aliasSubstitutions(alias, reference, walk.substitutions);

  if (substitutions === null) return null;

  return { type: alias.typeAnnotation, walk: { ...walk, aliases: new Set([...walk.aliases, name]), substitutions } };
}
