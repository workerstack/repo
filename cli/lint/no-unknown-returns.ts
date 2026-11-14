/** Ported from anti-slop (MIT, see anti-slop.LICENSE): `src/rules/no-unknown-returns.ts`. */
import { AST_NODE_TYPES, ESLintUtils, type TSESTree } from "@typescript-eslint/utils";

import { type FunctionOwner, functionVisitors } from "./function-visitors.ts";
import type { RepoRule } from "./rule.types.ts";
import { typeAliasEnvironmentOf, resolvedTypeMatches, type TypeAliasEnvironment } from "./type-aliases.ts";

const MESSAGE =
  "This function exposes `unknown` to its caller. Parse the value at its boundary and return a named domain type.";

/** The promise types whose first argument is the value an `await` hands the caller. */
const PROMISES: readonly string[] = ["Promise", "PromiseLike"];

/** The value type `type` promises, or undefined when it is no `Promise` or `PromiseLike` with an argument. */
function promisedValue(type: TSESTree.TypeNode): TSESTree.TypeNode | undefined {
  if (type.type !== AST_NODE_TYPES.TSTypeReference) return undefined;
  const { typeName } = type;
  const isPromise = typeName.type === AST_NODE_TYPES.Identifier && PROMISES.includes(typeName.name);

  return isPromise ? (type.typeArguments ?? undefined)?.params[0] : undefined;
}

/** Whether `type` is `unknown`, a union holding it or a promise of either, once resolved through visible aliases. */
function resolvesToUnknown(type: TSESTree.TypeNode, environment: TypeAliasEnvironment): boolean {
  return resolvedTypeMatches(type, environment, (resolved, matches) => {
    if (resolved.type === AST_NODE_TYPES.TSUnknownKeyword) return true;

    if (resolved.type === AST_NODE_TYPES.TSUnionType) return resolved.types.some(matches);
    const value = promisedValue(resolved);

    return value !== undefined && matches(value);
  });
}

/**
 * Fails a function, method, signature or function type whose return annotation is `unknown`, a union holding it,
 * `Promise<unknown>` or `PromiseLike<unknown>`, or a visible local alias resolving to one: the caller gets a value
 * nobody parsed. A type parameter, mapped key or `infer` binder of the same name shadows the alias, as does a nearer
 * declaration; an inferred return and an object holding `unknown`, as `{ cause: unknown }`, pass.
 */
export const noUnknownReturns: RepoRule<"unknownReturn"> = {
  create(context) {
    let environment: TypeAliasEnvironment | null = null;

    function check(node: FunctionOwner): void {
      const aliases = ESLintUtils.nullThrows(environment, "the Program visitor runs first");
      const annotation = node.returnType ?? undefined;

      if (annotation === undefined || !resolvesToUnknown(annotation.typeAnnotation, aliases)) return;
      context.report({ messageId: "unknownReturn", node: annotation.typeAnnotation });
    }

    return {
      ...functionVisitors(check),
      Program(program) {
        environment = typeAliasEnvironmentOf(program, context.sourceCode.visitorKeys);
      },
    };
  },
  defaultOptions: [],
  meta: {
    messages: { unknownReturn: MESSAGE },
    schema: [],
    type: "problem",
  },
};
