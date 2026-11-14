/**
 * Ported from anti-slop (MIT, see anti-slop.LICENSE): `src/shared/type-alias-resolution.ts`. Resolves a type
 * reference through the local type aliases visible at it, with lexical shadowing and generic arguments, so a rule can
 * match what an alias stands for. The environment is made once per program, for the first rule that asks in its
 * `Program` visitor.
 */
import { AST_NODE_TYPES, ESLintUtils, type TSESTree } from "@typescript-eslint/utils";

import { childNodes, lexicalTypeParameterNames, type VisitorKeys } from "./type-parameters.ts";

type Alias = TSESTree.TSTypeAliasDeclaration;

/** One declaration of a type name: the alias it is, or null for an interface, enum, class or import. */
type TypeBinding = { readonly alias: Alias | null; readonly name: string; readonly scope: TSESTree.Node };

/** What a type parameter stands for: the argument type and the substitutions in force where it was written. */
type Substitution = { readonly substitutions: Substitutions; readonly type: TSESTree.TypeNode };

type Substitutions = ReadonlyMap<string, Substitution>;

/** Every type alias and competing type binding of one program, by name. */
export type TypeAliasEnvironment = {
  readonly bindingsByName: ReadonlyMap<string, readonly TypeBinding[]>;
  readonly visitorKeys: VisitorKeys;
};

/** Matches one resolved type; `matches` resolves and matches a child type, such as a union member. */
export type ResolvedTypeMatcher = (type: TSESTree.TypeNode, matches: (child: TSESTree.TypeNode) => boolean) => boolean;

/** The node types that open a block scope for a type declaration. */
const SCOPES: readonly string[] = [
  AST_NODE_TYPES.BlockStatement,
  AST_NODE_TYPES.Program,
  AST_NODE_TYPES.StaticBlock,
  AST_NODE_TYPES.SwitchStatement,
  AST_NODE_TYPES.TSModuleBlock,
];

/** The nearest block scope holding `node`. */
function enclosingTypeScope(node: TSESTree.Node): TSESTree.Node {
  let current = node.parent;

  while (current !== undefined && !SCOPES.includes(current.type)) current = current.parent;

  return ESLintUtils.nullThrows(current, "every declaration sits under the program");
}

/** The interfaces, enums and classes, which bind a type name without being an alias. */
type Named =
  | TSESTree.TSInterfaceDeclaration
  | TSESTree.TSEnumDeclaration
  | TSESTree.ClassDeclaration
  | TSESTree.ClassExpression;

/** Whether `node` is an interface, enum or class. */
function isNamed(node: TSESTree.Node): node is Named {
  const { type } = node;

  return (
    type === AST_NODE_TYPES.TSInterfaceDeclaration ||
    type === AST_NODE_TYPES.TSEnumDeclaration ||
    type === AST_NODE_TYPES.ClassDeclaration ||
    type === AST_NODE_TYPES.ClassExpression
  );
}

/** Whether `node` is an import specifier, which binds its local name. */
function isImport(node: TSESTree.Node): node is TSESTree.ImportClause {
  const { type } = node;

  return (
    type === AST_NODE_TYPES.ImportSpecifier ||
    type === AST_NODE_TYPES.ImportDefaultSpecifier ||
    type === AST_NODE_TYPES.ImportNamespaceSpecifier
  );
}

/** The type name `node` declares and the alias it is, or null for a node that declares no type name. */
function declaredTypeBinding(node: TSESTree.Node): Omit<TypeBinding, "scope"> | null {
  if (node.type === AST_NODE_TYPES.TSTypeAliasDeclaration) return { alias: node, name: node.id.name };

  if (isImport(node)) return { alias: null, name: node.local.name };

  return isNamed(node) && node.id !== null ? { alias: null, name: node.id.name } : null;
}

/** Adds every type binding under `node` to `bindingsByName`. */
function collectTypeBindings(
  node: TSESTree.Node,
  visitorKeys: VisitorKeys,
  bindingsByName: Map<string, TypeBinding[]>,
): void {
  const declared = declaredTypeBinding(node);

  if (declared !== null) {
    const bindings = bindingsByName.get(declared.name) ?? [];

    bindings.push({ ...declared, scope: enclosingTypeScope(node) });
    bindingsByName.set(declared.name, bindings);
  }

  for (const child of childNodes(node, visitorKeys)) collectTypeBindings(child, visitorKeys, bindingsByName);
}

/**
 * The lookup of each program's environment, which walks a program once however many rules ask: a rule asks in its
 * `Program` visitor. The programs are held weakly, so one is dropped once the linter is done with it.
 */
function environmentMemo(): (program: TSESTree.Program, visitorKeys: VisitorKeys) => TypeAliasEnvironment {
  const known = new WeakMap<TSESTree.Program, TypeAliasEnvironment>();

  return (program, visitorKeys) => {
    const found = known.get(program);

    if (found !== undefined) return found;
    const bindingsByName = new Map<string, TypeBinding[]>();
    collectTypeBindings(program, visitorKeys, bindingsByName);
    const environment = { bindingsByName, visitorKeys };
    known.set(program, environment);

    return environment;
  };
}

/** Every type alias and competing type binding in `program`, walked for the first rule that asks, kept for the rest. */
export const typeAliasEnvironmentOf: (program: TSESTree.Program, visitorKeys: VisitorKeys) => TypeAliasEnvironment =
  /* @__PURE__ */ environmentMemo();

/** How many parents up from `node` `ancestor` is, or null when it is no ancestor. */
function ancestorDistance(ancestor: TSESTree.Node, node: TSESTree.Node): number | null {
  let current = node;
  let distance = 0;

  while (current !== ancestor) {
    if (current.type === AST_NODE_TYPES.Program) return null;
    current = current.parent;
    distance += 1;
  }

  return distance;
}

/** The bindings of `name` in the nearest scope that holds `use`. */
function nearestTypeBindings(name: string, use: TSESTree.Node, environment: TypeAliasEnvironment): TypeBinding[] {
  let nearestDistance = Number.POSITIVE_INFINITY;
  let nearest: TypeBinding[] = [];

  for (const candidate of environment.bindingsByName.get(name) ?? []) {
    const distance = ancestorDistance(candidate.scope, use);

    if (distance === null || distance > nearestDistance) continue;

    if (distance === nearestDistance) nearest.push(candidate);
    else [nearestDistance, nearest] = [distance, [candidate]];
  }

  return nearest;
}

/** The alias `name` names at `use`, or null when a binder or another declaration shadows it, or none is visible. */
export function visibleTypeAlias(name: string, use: TSESTree.Node, environment: TypeAliasEnvironment): Alias | null {
  if (lexicalTypeParameterNames(use, environment.visitorKeys).has(name)) return null;
  const [only, ...rest] = nearestTypeBindings(name, use, environment);

  return only !== undefined && rest.length === 0 ? only.alias : null;
}

/**
 * Whether a type parameter, mapped key, `infer` binder or local declaration binds `name` at `use`, so a built-in type
 * of that name, as `Record`, is shadowed there.
 */
export function hasVisibleTypeBinding(name: string, use: TSESTree.Node, environment: TypeAliasEnvironment): boolean {
  return (
    lexicalTypeParameterNames(use, environment.visitorKeys).has(name) ||
    nearestTypeBindings(name, use, environment).length > 0
  );
}

/** The substitutions in force inside `alias` as `reference` instantiates it, or null when an argument is missing. */
function aliasSubstitutions(alias: Alias, reference: TSESTree.TSTypeReference, base: Substitutions) {
  const explicit = reference.typeArguments?.params ?? [];
  const next = new Map(base);

  for (const [index, parameter] of (alias.typeParameters?.params ?? []).entries()) {
    const argument = explicit[index];
    const type = argument ?? parameter.default ?? undefined;

    if (type === undefined) return null;
    next.set(parameter.name.name, { substitutions: new Map(argument === undefined ? next : base), type });
  }

  return next;
}

/** What one resolution step is working on: the substitutions in force and the aliases already being expanded. */
type Resolving = { readonly substitutions: Substitutions; readonly aliases: ReadonlySet<Alias> };

/** The type and its resolution state that `reference` stands for one step on, or null when it is no alias. */
function expand(reference: TSESTree.TSTypeReference, state: Resolving, environment: TypeAliasEnvironment) {
  if (reference.typeName.type !== AST_NODE_TYPES.Identifier) return null;
  const { name } = reference.typeName;
  const substitution = state.substitutions.get(name);

  if (substitution !== undefined && (reference.typeArguments ?? undefined) === undefined)
    return { state: { ...state, substitutions: substitution.substitutions }, type: substitution.type };
  const alias = visibleTypeAlias(name, reference, environment);

  if (alias === null || state.aliases.has(alias)) return null;
  const substitutions = aliasSubstitutions(alias, reference, state.substitutions);

  if (substitutions === null) return null;

  return { state: { aliases: new Set([...state.aliases, alias]), substitutions }, type: alias.typeAnnotation };
}

/** Whether `type`, with visible aliases resolved and their type parameters substituted, satisfies `matcher`. */
export function resolvedTypeMatches(
  type: TSESTree.TypeNode,
  environment: TypeAliasEnvironment,
  matcher: ResolvedTypeMatcher,
): boolean {
  function evaluate(current: TSESTree.TypeNode, state: Resolving): boolean {
    const next = current.type === AST_NODE_TYPES.TSTypeReference ? expand(current, state, environment) : null;

    if (next !== null) return evaluate(next.type, next.state);

    return matcher(current, (child) => evaluate(child, state));
  }

  return evaluate(type, { aliases: new Set(), substitutions: new Map() });
}
