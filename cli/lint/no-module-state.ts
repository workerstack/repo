import type { ESTree } from "@oxlint/plugins";

import type { RepoRule } from "./rule.types.ts";

const MESSAGE =
  "module-scope state outlives every caller; move it into a function, or make it a const with a Readonly type";
/** Wrappers that change a value's type, never the value: `(x)`, `x as T`, `x satisfies T`, `x!` and `<T>x`. */
const WRAPPERS = [
  "ParenthesizedExpression",
  "TSAsExpression",
  "TSSatisfiesExpression",
  "TSNonNullExpression",
  "TSTypeAssertion",
];
/** A const annotated with one of these is read-only to every caller, so it holds no state they can change. */
const READONLY = ["ReadonlySet", "ReadonlyMap", "Readonly"];

type Expression = ESTree.Expression;
type Wrapper =
  | ESTree.ParenthesizedExpression
  | ESTree.TSAsExpression
  | ESTree.TSSatisfiesExpression
  | ESTree.TSNonNullExpression
  | ESTree.TSTypeAssertion;

function isWrapper(node: Expression): node is Wrapper {
  return WRAPPERS.includes(node.type);
}

function unwrap(node: Expression | null): Expression | null {
  let current = node;
  while (current !== null && isWrapper(current)) current = current.expression;
  return current;
}

function readonlyAnnotated(declarator: ESTree.VariableDeclarator): boolean {
  const annotation = declarator.id.typeAnnotation?.typeAnnotation;
  if (annotation?.type !== "TSTypeReference" || annotation.typeName.type !== "Identifier") return false;
  return READONLY.includes(annotation.typeName.name);
}

/** A declarator whose value is constructed once at import and shared by every caller. */
function constructed(declarator: ESTree.VariableDeclarator): boolean {
  return unwrap(declarator.init)?.type === "NewExpression" && !readonlyAnnotated(declarator);
}

function isState(node: ESTree.VariableDeclaration): boolean {
  if (node.declare === true) return false;
  return node.kind !== "const" || node.declarations.some(constructed);
}

/** Fails a module-scope `let`, `var` or `using`, and a `const` holding a `new` object, exported or not. */
export const noModuleState: RepoRule = {
  create(context) {
    return {
      VariableDeclaration(node) {
        const statement = node.parent.type === "ExportNamedDeclaration" ? node.parent : node;
        if (statement.parent.type === "Program" && isState(node)) context.report({ message: MESSAGE, node });
      },
    };
  },
};
