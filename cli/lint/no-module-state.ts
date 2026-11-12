import { AST_NODE_TYPES, type TSESTree } from "@typescript-eslint/utils";

import type { RepoRule } from "./rule.types.ts";

const MESSAGE =
  "module-scope state outlives every caller; move it into a function, or make it a const with a Readonly type";
/** Wrappers that change a value's type, never the value: `x as T`, `x satisfies T`, `x!` and `<T>x`. */
const WRAPPERS = ["TSAsExpression", "TSSatisfiesExpression", "TSNonNullExpression", "TSTypeAssertion"];
/** A const annotated with one of these is read-only to every caller, so it holds no state they can change. */
const READONLY = ["ReadonlySet", "ReadonlyMap", "Readonly"];

type Expression = TSESTree.Expression;
type Wrapper =
  | TSESTree.TSAsExpression
  | TSESTree.TSSatisfiesExpression
  | TSESTree.TSNonNullExpression
  | TSESTree.TSTypeAssertion;

function isWrapper(node: Expression): node is Wrapper {
  return WRAPPERS.includes(node.type);
}

function unwrap(node: Expression | null): Expression | null {
  let current = node;
  while (current !== null && isWrapper(current)) current = current.expression;
  return current;
}

function readonlyAnnotated(declarator: TSESTree.VariableDeclarator): boolean {
  const annotation = declarator.id.typeAnnotation?.typeAnnotation;
  if (annotation?.type !== AST_NODE_TYPES.TSTypeReference || annotation.typeName.type !== AST_NODE_TYPES.Identifier)
    return false;
  return READONLY.includes(annotation.typeName.name);
}

/** A declarator whose value is constructed once at import and shared by every caller. */
function constructed(declarator: TSESTree.VariableDeclarator): boolean {
  return unwrap(declarator.init)?.type === AST_NODE_TYPES.NewExpression && !readonlyAnnotated(declarator);
}

function isState(node: TSESTree.VariableDeclaration): boolean {
  if (node.declare) return false;
  return node.kind !== "const" || node.declarations.some(constructed);
}

/** Fails a module-scope `let`, `var` or `using`, and a `const` holding a `new` object, exported or not. */
export const noModuleState: RepoRule<"state"> = {
  create(context) {
    return {
      VariableDeclaration(node) {
        const statement = node.parent.type === AST_NODE_TYPES.ExportNamedDeclaration ? node.parent : node;
        if (statement.parent.type === AST_NODE_TYPES.Program && isState(node))
          context.report({ messageId: "state", node });
      },
    };
  },
  defaultOptions: [],
  meta: {
    messages: { state: MESSAGE },
    schema: [],
    type: "problem",
  },
};
