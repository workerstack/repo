/** Ported from anti-slop (MIT, see anti-slop.LICENSE): `src/shared/reflect-method.ts`. */
import { AST_NODE_TYPES, type TSESLint, type TSESTree } from "@typescript-eslint/utils";

import { REFLECT } from "./reflect.constants.ts";
import { resolveVariable } from "./resolve-variable.ts";

/** Whether `expression` is the global `Reflect`: no binding, or one the code itself never declares. */
function isGlobalReflect(sourceCode: Readonly<TSESLint.SourceCode>, expression: TSESTree.Expression): boolean {
  if (expression.type !== AST_NODE_TYPES.Identifier || expression.name !== REFLECT) return false;
  const variable = resolveVariable(sourceCode, expression);

  return variable === null || variable.defs.length === 0;
}

/** Whether `callee` is `Reflect.<methodName>` or `Reflect["<methodName>"]` on the global Reflect object. */
export function isGlobalReflectMethodCall(
  sourceCode: Readonly<TSESLint.SourceCode>,
  callee: TSESTree.Expression,
  methodName: string,
): boolean {
  if (callee.type !== AST_NODE_TYPES.MemberExpression || !isGlobalReflect(sourceCode, callee.object)) return false;
  const { property } = callee;

  return callee.computed
    ? property.type === AST_NODE_TYPES.Literal && property.value === methodName
    : property.type === AST_NODE_TYPES.Identifier && property.name === methodName;
}
