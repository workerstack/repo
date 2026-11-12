/** Ported from anti-slop (MIT, see anti-slop.LICENSE): `src/rules/no-object-parameters.ts`. */
import { AST_NODE_TYPES, ESLintUtils, type TSESTree } from "@typescript-eslint/utils";

import { functionParameterBindingName, functionParameterTypeAnnotation } from "./function-parameters.ts";
import type { RepoRule } from "./rule.types.ts";
import { createTypeAliasEnvironment, resolvedTypeMatches, type TypeAliasEnvironment } from "./type-aliases.ts";

/** Every node that owns a parameter list: functions, their declared signatures and function types. */
type ParameterOwner =
  | TSESTree.FunctionLike
  | TSESTree.TSCallSignatureDeclaration
  | TSESTree.TSConstructSignatureDeclaration
  | TSESTree.TSConstructorType
  | TSESTree.TSFunctionType
  | TSESTree.TSMethodSignature;

const MESSAGE =
  "Parameter `{{parameter}}` uses the broad `object` type. Accept a named owner type; " +
  "parse external input at its boundary before calling this function.";

/** Whether `type` is `object` or a union holding it, once resolved through visible aliases. */
function resolvesToObject(type: TSESTree.TypeNode, environment: TypeAliasEnvironment): boolean {
  return resolvedTypeMatches(
    type,
    environment,
    (resolved, matches) =>
      resolved.type === AST_NODE_TYPES.TSObjectKeyword ||
      (resolved.type === AST_NODE_TYPES.TSUnionType && resolved.types.some(matches)),
  );
}

/**
 * Fails a parameter typed `object`, a union holding it, or a visible local alias resolving to either, on any function,
 * method, signature or function type: `object` drops every fact about the input. A type parameter, mapped key or
 * `infer` binder of the same name shadows the alias, as does a nearer declaration.
 */
export const noObjectParameters: RepoRule<"objectParameter"> = {
  create(context) {
    let environment: TypeAliasEnvironment | null = null;

    function check(node: ParameterOwner): void {
      const aliases = ESLintUtils.nullThrows(environment, "the Program visitor runs first");

      for (const parameter of node.params) {
        const annotation = functionParameterTypeAnnotation(parameter);

        if (annotation === undefined || !resolvesToObject(annotation.typeAnnotation, aliases)) continue;
        const name = functionParameterBindingName(parameter, annotation, context.sourceCode);

        context.report({ data: { parameter: name }, messageId: "objectParameter", node: annotation.typeAnnotation });
      }
    }

    return {
      ArrowFunctionExpression: check,
      FunctionDeclaration: check,
      FunctionExpression: check,
      Program(program) {
        environment = createTypeAliasEnvironment(program, context.sourceCode.visitorKeys);
      },
      TSCallSignatureDeclaration: check,
      TSConstructSignatureDeclaration: check,
      TSConstructorType: check,
      TSDeclareFunction: check,
      TSEmptyBodyFunctionExpression: check,
      TSFunctionType: check,
      TSMethodSignature: check,
    };
  },
  defaultOptions: [],
  meta: {
    messages: { objectParameter: MESSAGE },
    schema: [],
    type: "problem",
  },
};
