import { AST_NODE_TYPES, type TSESTree } from "@typescript-eslint/utils";

import type { RepoRule } from "./rule.types.ts";

type Parameter = TSESTree.Parameter;
type Func = TSESTree.FunctionLike;

/** Whether the function is one a caller names: a declaration, a class member but a setter, or a function const. */
function isDeclared(node: Func): boolean {
  if (node.type === AST_NODE_TYPES.FunctionDeclaration || node.type === AST_NODE_TYPES.TSDeclareFunction) return true;
  const { parent } = node;
  if (parent.type === AST_NODE_TYPES.MethodDefinition || parent.type === AST_NODE_TYPES.TSAbstractMethodDefinition)
    return parent.kind !== "set";
  return ["VariableDeclarator", "PropertyDefinition", "TSAbstractPropertyDefinition"].includes(parent.type);
}

/** Whether a type is `boolean` or a union with it as a member. */
function hasBoolean(type: TSESTree.TypeNode): boolean {
  if (type.type === AST_NODE_TYPES.TSBooleanKeyword) return true;
  return type.type === AST_NODE_TYPES.TSUnionType && type.types.some(hasBoolean);
}

/** The identifier a parameter binds, with the default it carries; null for a pattern or a rest. */
function identifierOf(param: Parameter): { id: TSESTree.Identifier; fallback: TSESTree.Expression | null } | null {
  if (param.type === AST_NODE_TYPES.TSParameterProperty) return identifierOf(param.parameter);
  if (param.type === AST_NODE_TYPES.AssignmentPattern)
    return param.left.type === AST_NODE_TYPES.Identifier ? { fallback: param.right, id: param.left } : null;
  return param.type === AST_NODE_TYPES.Identifier ? { fallback: null, id: param } : null;
}

/** The name of a parameter typed boolean, or defaulted to true or false when untyped; null for any other. */
function flagName(param: Parameter): string | null {
  const found = identifierOf(param);
  if (found === null) return null;
  const annotation = found.id.typeAnnotation?.typeAnnotation;
  if (annotation !== undefined) return hasBoolean(annotation) ? found.id.name : null;
  const { fallback } = found;
  return fallback?.type === AST_NODE_TYPES.Literal && typeof fallback.value === "boolean" ? found.id.name : null;
}

/**
 * Fails a boolean parameter of a function declaration, `declare` or overload signature, class method, constructor,
 * function const or class field holding a function: `f(x, true)` hides what the flag means at the call. A callback,
 * an object literal method, a setter and a signature in an interface or type literal pass, as does a destructured
 * options parameter. Reads the annotation and the default only, since oxlint gives a rule no types.
 */
export const noBooleanParam: RepoRule<"flag"> = {
  create(context) {
    function check(node: Func): void {
      if (!isDeclared(node)) return;
      for (const param of node.params) {
        const name = flagName(param);
        if (name !== null) context.report({ data: { name }, messageId: "flag", node: param });
      }
    }
    return {
      ArrowFunctionExpression: check,
      FunctionDeclaration: check,
      FunctionExpression: check,
      TSDeclareFunction: check,
      TSEmptyBodyFunctionExpression: check,
    };
  },
  defaultOptions: [],
  meta: {
    messages: {
      flag:
        "`{{name}}: boolean` is a positional flag the call cannot name; " +
        "take an options object ({ {{name}} }) or split the function in two",
    },
    schema: [],
    type: "problem",
  },
};
