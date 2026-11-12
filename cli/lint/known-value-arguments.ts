/**
 * Ported from anti-slop (MIT, see anti-slop.LICENSE): the evidence half of `src/rules/no-known-value-widening.ts`.
 * Whether an expression's value is known where it is written, by its own syntax or a const that holds one, and
 * whether an argument to a type predicate carries a type more informative than the predicate's `unknown`.
 */
import { AST_NODE_TYPES, TSESLint, type TSESTree } from "@typescript-eslint/utils";

import { classifyUnsafeDictionaryValue } from "./dictionary-types.ts";
import type { TypeEnvironment } from "./dictionary-walk.ts";
import { functionParameterBindingName, functionParameterTypeAnnotation } from "./function-parameters.ts";
import { resolveVariable } from "./resolve-variable.ts";
import { BUILT_VALUES, functionLike } from "./widen-evidence.ts";

type SourceCode = Readonly<TSESLint.SourceCode>;

type Variable = TSESLint.Scope.Variable;

type Definition = TSESLint.Scope.Definition;

type FunctionLike = TSESTree.FunctionLike;

/** A function's annotated parameter: its annotation, its position and the name it binds. */
export type AnnotatedParameter = { annotation: TSESTree.TSTypeAnnotation; index: number; name: string };

/** An expression that only restates the type of the one it wraps. */
type Wrapper =
  | TSESTree.TSAsExpression
  | TSESTree.TSNonNullExpression
  | TSESTree.TSSatisfiesExpression
  | TSESTree.TSTypeAssertion;

const WRAPPERS: readonly string[] = [
  AST_NODE_TYPES.TSAsExpression,
  AST_NODE_TYPES.TSNonNullExpression,
  AST_NODE_TYPES.TSSatisfiesExpression,
  AST_NODE_TYPES.TSTypeAssertion,
];

const { DefinitionType } = TSESLint.Scope;

function isWrapper(node: TSESTree.Node): node is Wrapper {
  return WRAPPERS.includes(node.type);
}

/** `expression` past every assertion, `satisfies` and non-null operator around it. */
export function unwrapExpression(expression: TSESTree.Expression): TSESTree.Expression {
  return isWrapper(expression) ? unwrapExpression(expression.expression) : expression;
}

/** The one definition of `variable`, null when it has none or several. */
function soleDefinition(variable: Variable): Definition | null {
  const [definition, ...rest] = variable.defs;

  return definition !== undefined && rest.length === 0 ? definition : null;
}

/** The declarator of `variable` when it has one definition and that is a variable declarator. */
export function variableDeclarator(variable: Variable): TSESTree.VariableDeclarator | null {
  const definition = soleDefinition(variable);

  return definition?.node.type === AST_NODE_TYPES.VariableDeclarator ? definition.node : null;
}

/** The initializer of `variable` when it is a `const` with one that nothing writes again. */
function stableInitializer(variable: Variable): TSESTree.Expression | null {
  const declarator = variableDeclarator(variable);
  const isStable = variable.references.every((reference) => reference.init === true || !reference.isWrite());

  return declarator?.parent.kind === "const" && isStable ? declarator.init : null;
}

/** Whether `expression` builds its value right there, as a literal, an object, an array, a function or a `new`. */
function isKnownEvidenceExpression(expression: TSESTree.Expression): boolean {
  return BUILT_VALUES.includes(unwrapExpression(expression).type);
}

/** Whether `expression`'s value is known: built where it is written, or a stable const holding such a value. */
export function hasKnownEvidence(
  sourceCode: SourceCode,
  expression: TSESTree.Expression,
  visited: ReadonlySet<Variable> = new Set(),
): boolean {
  if (isKnownEvidenceExpression(expression)) return true;
  const current = unwrapExpression(expression);
  const variable = current.type === AST_NODE_TYPES.Identifier ? resolveVariable(sourceCode, current) : null;
  const initializer = variable === null || visited.has(variable) ? null : stableInitializer(variable);

  return (
    variable !== null &&
    initializer !== null &&
    hasKnownEvidence(sourceCode, initializer, new Set([...visited, variable]))
  );
}

/** The function `definition` declares, or the one its declarator's initializer holds. */
function definedFunction(definition: Definition): FunctionLike | null {
  if (definition.type === DefinitionType.FunctionName) return functionLike(definition.node);
  const declarator = definition.node.type === AST_NODE_TYPES.VariableDeclarator ? definition.node : null;
  const init = declarator?.init ?? undefined;
  const initializer = init === undefined ? null : unwrapExpression(init);

  return initializer === null ? null : functionLike(initializer);
}

/** The function `callee` calls when the file declares it: an inline function, or a function or const that holds one. */
export function localFunctionForCall(sourceCode: SourceCode, callee: TSESTree.Expression): FunctionLike | null {
  const current = unwrapExpression(callee);
  const inline = functionLike(current);

  if (inline !== null) return inline;
  const variable = current.type === AST_NODE_TYPES.Identifier ? resolveVariable(sourceCode, current) : null;
  const definition = variable === null ? null : soleDefinition(variable);

  return definition === null ? null : definedFunction(definition);
}

/** `owner`'s annotated parameter that binds `name`, with its position; null when none does. */
function annotatedParameter(sourceCode: SourceCode, owner: FunctionLike, name: string): AnnotatedParameter | null {
  for (const [index, parameter] of owner.params.entries()) {
    const annotation = functionParameterTypeAnnotation(parameter);

    if (annotation !== undefined && functionParameterBindingName(parameter, annotation, sourceCode) === name)
      return { annotation, index, name };
  }

  return null;
}

/** The annotated parameter `owner`'s type predicate `name is T` names; null when it has no such predicate. */
export function predicateSubject(sourceCode: SourceCode, owner: FunctionLike): AnnotatedParameter | null {
  const predicate = (owner.returnType ?? undefined)?.typeAnnotation;

  if (predicate?.type !== AST_NODE_TYPES.TSTypePredicate || predicate.parameterName.type !== AST_NODE_TYPES.Identifier)
    return null;

  return annotatedParameter(sourceCode, owner, predicate.parameterName.name);
}

/** The annotation `variable` was declared with, as a single variable or a function parameter; null when none. */
function variableTypeAnnotation(sourceCode: SourceCode, variable: Variable): TSESTree.TSTypeAnnotation | null {
  const definition = soleDefinition(variable);
  const declarator = variableDeclarator(variable);

  if (declarator?.id.type === AST_NODE_TYPES.Identifier) return declarator.id.typeAnnotation ?? null;
  const owner = definition?.type === DefinitionType.Parameter ? functionLike(definition.node) : null;

  return owner === null ? null : (annotatedParameter(sourceCode, owner, variable.name)?.annotation ?? null);
}

/** Whether `type` says more than an escape hatch such as `unknown`, `any` or `object` would. */
function hasInformativeType(type: TSESTree.TypeNode, environment: TypeEnvironment): boolean {
  return classifyUnsafeDictionaryValue(type, environment) === undefined;
}

/** Whether the call `call` is to a local function whose written return type is informative. */
function hasInformativeReturn(sourceCode: SourceCode, call: TSESTree.CallExpression, types: TypeEnvironment): boolean {
  const returnType = (localFunctionForCall(sourceCode, call.callee)?.returnType ?? undefined)?.typeAnnotation;

  return returnType !== undefined && hasInformativeType(returnType, types);
}

/**
 * Whether the argument `expression` carries a known type: a built value, an informative assertion, a local function's
 * informative return type, or a variable annotated informatively or a stable const holding one of these.
 */
export function hasKnownCallArgumentEvidence(
  sourceCode: SourceCode,
  expression: TSESTree.Expression,
  environment: TypeEnvironment,
): boolean {
  const visited = new Set<Variable>();

  function knownVariable(identifier: TSESTree.Identifier): boolean {
    const variable = resolveVariable(sourceCode, identifier);

    if (variable === null || visited.has(variable)) return false;
    visited.add(variable);
    const annotation = variableTypeAnnotation(sourceCode, variable);

    if (annotation !== null) return hasInformativeType(annotation.typeAnnotation, environment);
    const initializer = stableInitializer(variable);

    return initializer !== null && known(initializer);
  }

  function known(current: TSESTree.Expression): boolean {
    if (current.type === AST_NODE_TYPES.TSAsExpression || current.type === AST_NODE_TYPES.TSTypeAssertion)
      return hasInformativeType(current.typeAnnotation, environment);

    if (isWrapper(current)) return known(current.expression);

    if (current.type === AST_NODE_TYPES.CallExpression) return hasInformativeReturn(sourceCode, current, environment);

    return current.type === AST_NODE_TYPES.Identifier ? knownVariable(current) : isKnownEvidenceExpression(current);
  }

  return known(expression);
}
