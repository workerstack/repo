/** Ported from anti-slop (MIT, see anti-slop.LICENSE): `src/rules/no-unknown-type-aliases.ts`. */
import { AST_NODE_TYPES, ESLintUtils, type TSESTree } from "@typescript-eslint/utils";

import type { RepoRule } from "./rule.types.ts";
import { typeAliasEnvironmentOf, resolvedTypeMatches, type TypeAliasEnvironment } from "./type-aliases.ts";

const MESSAGE =
  "Type alias `{{alias}}` hides `unknown`. Keep `unknown` explicit at the parsing boundary or on an allowed " +
  "`cause` field; otherwise use the parsed owner type.";

/** Whether `type` is `unknown` or a union holding it, once resolved through visible aliases. */
function resolvesToUnknown(type: TSESTree.TypeNode, environment: TypeAliasEnvironment): boolean {
  return resolvedTypeMatches(
    type,
    environment,
    (resolved, matches) =>
      resolved.type === AST_NODE_TYPES.TSUnknownKeyword ||
      (resolved.type === AST_NODE_TYPES.TSUnionType && resolved.types.some(matches)),
  );
}

/**
 * Fails a type alias that resolves to `unknown` or a union holding it, through visible local aliases and their
 * arguments: the name hides that the value was never parsed. An alias holding `unknown` inside an object, array or
 * promise passes; every alias that resolves to `unknown` reports, at its name.
 */
export const noUnknownTypeAliases: RepoRule<"unknownAlias"> = {
  create(context) {
    let environment: TypeAliasEnvironment | null = null;

    return {
      Program(program) {
        environment = typeAliasEnvironmentOf(program, context.sourceCode.visitorKeys);
      },
      TSTypeAliasDeclaration(node) {
        const aliases = ESLintUtils.nullThrows(environment, "the Program visitor runs first");

        if (!resolvesToUnknown(node.typeAnnotation, aliases)) return;
        context.report({ data: { alias: node.id.name }, messageId: "unknownAlias", node: node.id });
      },
    };
  },
  defaultOptions: [],
  meta: {
    messages: { unknownAlias: MESSAGE },
    schema: [],
    type: "problem",
  },
};
