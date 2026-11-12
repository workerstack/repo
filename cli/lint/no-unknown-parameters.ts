/** Ported from anti-slop (MIT, see anti-slop.LICENSE): `src/rules/no-unknown-parameters.ts`. */
import { AST_NODE_TYPES } from "@typescript-eslint/utils";

import { CAUSE } from "./cause.constants.ts";
import {
  containsUnknownType,
  functionParameterBindingName,
  functionParameterTypeAnnotation,
} from "./function-parameters.ts";
import { type FunctionOwner, functionVisitors } from "./function-visitors.ts";
import type { RepoRule } from "./rule.types.ts";

const MESSAGE =
  "Parameter `{{parameter}}` leaves input unparsed. Accept a named domain type; " +
  "run the expected schema or parser at the I/O boundary before calling this function.";

/** Whether `owner` returns `name is X` or `asserts name is X`, so its `name` parameter is the predicate's subject. */
function isTypePredicateSubject(owner: FunctionOwner, name: string): boolean {
  const predicate = (owner.returnType ?? undefined)?.typeAnnotation;

  return (
    predicate?.type === AST_NODE_TYPES.TSTypePredicate &&
    predicate.parameterName.type === AST_NODE_TYPES.Identifier &&
    predicate.parameterName.name === name
  );
}

/**
 * Fails a parameter typed `unknown` or a union holding it, on any function, method, signature or function type: the
 * function takes input nobody parsed. A parameter named `cause`, which enriches an error, and the subject of the
 * function's own type predicate pass, as does `unknown` inside another type, as `unknown[]`.
 */
export const noUnknownParameters: RepoRule<"unknownParameter"> = {
  create(context) {
    function check(node: FunctionOwner): void {
      for (const parameter of node.params) {
        const annotation = functionParameterTypeAnnotation(parameter);

        if (annotation === undefined || !containsUnknownType(annotation.typeAnnotation)) continue;
        const name = functionParameterBindingName(parameter, annotation, context.sourceCode);

        if (name === CAUSE || isTypePredicateSubject(node, name)) continue;
        context.report({ data: { parameter: name }, messageId: "unknownParameter", node: annotation.typeAnnotation });
      }
    }

    return functionVisitors(check);
  },
  defaultOptions: [],
  meta: {
    messages: { unknownParameter: MESSAGE },
    schema: [],
    type: "problem",
  },
};
