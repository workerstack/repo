/**
 * The binding side of `repo/no-widen-then-assert`: which const widens a value whose type was known, and what that
 * type was. Ported from anti-slop (MIT, see anti-slop.LICENSE): `src/rules/no-widen-then-assert.ts`.
 */
import { AST_NODE_TYPES, type TSESLint, type TSESTree } from "@typescript-eslint/utils";

import { resolveVariable } from "./resolve-variable.ts";
import { type BroadTypeKind, broadTypeKind } from "./widen-types.ts";

/** What was known of a value before it was widened: its type when one was written, null for a literal or `new`. */
type KnownValueEvidence = { readonly type: TSESTree.TypeNode | null };
/** A const that widens a known value: how it widens, what was known, where it ends and the function it is in. */
export type WidenedBinding = {
  readonly boundary: TSESTree.Node | null;
  readonly broadKind: BroadTypeKind;
  readonly declaredAt: number;
  readonly evidence: KnownValueEvidence;
};

type SourceCode = Readonly<TSESLint.SourceCode>;
type Variable = TSESLint.Scope.Variable;
type Assertion = TSESTree.TSAsExpression | TSESTree.TSTypeAssertion;

const FUNCTIONS: readonly string[] = [
  "ArrowFunctionExpression",
  "FunctionDeclaration",
  "FunctionExpression",
  "TSDeclareFunction",
  "TSEmptyBodyFunctionExpression",
];
/** Expressions whose value is built right there, so its shape is known. */
const BUILT_VALUES: readonly string[] = [
  "ArrayExpression",
  "ArrowFunctionExpression",
  "ClassExpression",
  "FunctionExpression",
  "Literal",
  "NewExpression",
  "ObjectExpression",
  "TemplateLiteral",
];

/** The innermost function `node` is in, or null at module level. */
export function functionBoundary(node: TSESTree.Node): TSESTree.Node | null {
  let current = node.parent;
  while (current !== undefined && current.type !== AST_NODE_TYPES.Program) {
    if (FUNCTIONS.includes(current.type)) return current;
    current = current.parent;
  }
  return null;
}

function asAssertion(expression: TSESTree.Expression): Assertion | null {
  return expression.type === AST_NODE_TYPES.TSAsExpression || expression.type === AST_NODE_TYPES.TSTypeAssertion
    ? expression
    : null;
}

/** The declarator of `variable` when it is a `const` with an initializer that nothing writes again. */
function fixedConst(variable: Variable): TSESTree.VariableDeclarator | null {
  const definition = variable.defs.find(({ node }) => node.type === AST_NODE_TYPES.VariableDeclarator);
  const declarator = definition?.node.type === AST_NODE_TYPES.VariableDeclarator ? definition.node : null;
  if (declarator?.parent.kind !== "const" || declarator.init === null) return null;
  return variable.references.some((reference) => reference.isWrite() && reference.init !== true) ? null : declarator;
}

/** What `variable` is known to hold in `boundary`: its own non-broad annotation, or its const initializer's. */
function variableEvidence(
  sourceCode: SourceCode,
  variable: Variable,
  context: { boundary: TSESTree.Node | null; visited: ReadonlySet<Variable> },
): KnownValueEvidence | null {
  const annotated = variable.identifiers.find((identifier) => identifier.typeAnnotation != null);
  const annotation = annotated?.typeAnnotation?.typeAnnotation;
  if (annotated !== undefined && annotation !== undefined) {
    const isLocal = functionBoundary(annotated) === context.boundary;
    return isLocal && broadTypeKind(annotation) === null ? { type: annotation } : null;
  }
  const declarator = fixedConst(variable);
  if (declarator?.init == null || functionBoundary(declarator) !== context.boundary) return null;
  const visited = new Set([...context.visited, variable]);
  return knownValueEvidence(sourceCode, declarator.init, { boundary: context.boundary, visited });
}

/** What is known of `expression`'s value in `boundary`, following consts not yet in `visited`; null when nothing. */
function knownValueEvidence(
  sourceCode: SourceCode,
  expression: TSESTree.Expression,
  context: { boundary: TSESTree.Node | null; visited: ReadonlySet<Variable> },
): KnownValueEvidence | null {
  const assertion = asAssertion(expression);
  if (assertion !== null)
    return broadTypeKind(assertion.typeAnnotation) === null ? { type: assertion.typeAnnotation } : null;
  if (BUILT_VALUES.includes(expression.type)) return { type: null };
  if (expression.type !== AST_NODE_TYPES.Identifier) return null;
  const variable = resolveVariable(sourceCode, expression);
  if (variable === null || context.visited.has(variable)) return null;
  return variableEvidence(sourceCode, variable, context);
}

/** How `declarator` widens, by its annotation or a broad `as` on its initializer, and the expression it widens. */
function widening(
  declarator: TSESTree.VariableDeclarator,
  init: TSESTree.Expression,
): { kind: BroadTypeKind; original: TSESTree.Expression } | null {
  const declared = declarator.id.typeAnnotation?.typeAnnotation;
  const assertion = asAssertion(init);
  const assertedKind = assertion === null ? null : broadTypeKind(assertion.typeAnnotation);
  const kind = (declared == null ? null : broadTypeKind(declared)) ?? assertedKind;
  if (kind === null) return null;
  return { kind, original: assertion !== null && assertedKind !== null ? assertion.expression : init };
}

/** The widening `variable` does, when it is a fixed const that widens a value whose type was known. */
export function widenedBinding(sourceCode: SourceCode, variable: Variable): WidenedBinding | null {
  const declarator = fixedConst(variable);
  if (declarator?.id.type !== AST_NODE_TYPES.Identifier || declarator.init === null) return null;
  const widened = widening(declarator, declarator.init);
  if (widened === null) return null;
  const boundary = functionBoundary(declarator);
  const evidence = knownValueEvidence(sourceCode, widened.original, { boundary, visited: new Set([variable]) });
  if (evidence === null) return null;
  return { boundary, broadKind: widened.kind, declaredAt: declarator.range[1], evidence };
}
