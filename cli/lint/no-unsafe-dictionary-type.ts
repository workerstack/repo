/** Ported from anti-slop (MIT, see anti-slop.LICENSE): `src/rules/no-unsafe-dictionary-type.ts`. */
import { AST_NODE_TYPES, ESLintUtils, type TSESTree } from "@typescript-eslint/utils";

import { classifyUnsafeDictionary, classifyUnsafeDictionaryValue, type UnsafeValue } from "./dictionary-types.ts";
import { createTypeEnvironment, referenceName, type TypeEnvironment } from "./dictionary-walk.ts";
import type { RepoRule } from "./rule.types.ts";
import { visibleTypeAlias } from "./type-aliases.ts";

const MESSAGE =
  "This dictionary's {{value}} value type gives callers no concrete value contract. " +
  "Use an owner/schema-derived value type; parse external payloads before insertion.";

/** The type nodes that can be a dictionary, each of which the rule visits. */
type DictionaryCandidate = TSESTree.TSMappedType | TSESTree.TSTypeLiteral | TSESTree.TSTypeReference;

const CANDIDATES: readonly string[] = [
  AST_NODE_TYPES.TSMappedType,
  AST_NODE_TYPES.TSTypeLiteral,
  AST_NODE_TYPES.TSTypeReference,
];

/** Whether `node` is a type node that can be a dictionary. */
function isCandidate(node: TSESTree.Node): node is DictionaryCandidate {
  return CANDIDATES.includes(node.type);
}

/** The nodes above `node`, nearest first, through the program. */
function ancestorsOf(node: TSESTree.Node): TSESTree.Node[] {
  const ancestors: TSESTree.Node[] = [];
  let current = node;

  while (current.type !== AST_NODE_TYPES.Program) {
    current = current.parent;
    ancestors.push(current);
  }

  return ancestors;
}

/** Whether `node` is a bare use of a visible alias outside every alias, which the alias reports for. */
function isPlainAliasUse(node: DictionaryCandidate, environment: TypeEnvironment): boolean {
  if (node.type !== AST_NODE_TYPES.TSTypeReference || (node.typeArguments ?? undefined) !== undefined) return false;
  const name = referenceName(node);

  return (
    name !== null &&
    visibleTypeAlias(name, node, environment.typeAliases) !== null &&
    !ancestorsOf(node).some((ancestor) => ancestor.type === AST_NODE_TYPES.TSTypeAliasDeclaration)
  );
}

/** Whether `node` sits in a type parameter's constraint, as `T extends Record<string, unknown>`, a caller's bound. */
function isInConstraint(node: DictionaryCandidate): boolean {
  const chain = [node, ...ancestorsOf(node)];

  return chain.some((child, index) => {
    const parent = chain[index + 1];

    return parent?.type === AST_NODE_TYPES.TSTypeParameter && parent.constraint === child;
  });
}

/** Whether an unsafe dictionary above `node` already reports for it. */
function isInUnsafeDictionary(node: DictionaryCandidate, environment: TypeEnvironment): boolean {
  return ancestorsOf(node).some(
    (ancestor) => isCandidate(ancestor) && classifyUnsafeDictionary(ancestor, environment) !== undefined,
  );
}

/**
 * Fails a `Record`, index signature or mapped type whose value type is `unknown`, `any`, `object`, `{}` (or a type
 * with only optional `never` members), or a union, intersection, wrapper or visible local alias holding one: such a
 * dictionary hands every caller an unchecked value. `Map`, a shadowed built-in, a type parameter constraint and a
 * nested value such as `{ payload: unknown }` pass; an unsafe alias reports once, at its declaration.
 */
export const noUnsafeDictionaryType: RepoRule<"unsafeDictionary"> = {
  create(context) {
    let environment: TypeEnvironment | null = null;

    function report(node: TSESTree.Node, value: UnsafeValue): void {
      context.report({ data: { value }, messageId: "unsafeDictionary", node });
    }

    function check(node: DictionaryCandidate): void {
      const types = ESLintUtils.nullThrows(environment, "the Program visitor runs first");
      const value = classifyUnsafeDictionary(node, types);

      if (value === undefined || isInConstraint(node) || isPlainAliasUse(node, types)) return;

      if (!isInUnsafeDictionary(node, types)) report(node, value);
    }

    return {
      Program(program) {
        environment = createTypeEnvironment(program, context.sourceCode.visitorKeys);
      },
      TSIndexSignature(node) {
        const types = ESLintUtils.nullThrows(environment, "the Program visitor runs first");
        const annotation = node.typeAnnotation ?? undefined;

        if (annotation === undefined || node.parent.type === AST_NODE_TYPES.TSTypeLiteral) return;
        const value = classifyUnsafeDictionaryValue(annotation.typeAnnotation, types);

        if (value !== undefined) report(node, value);
      },
      TSMappedType: check,
      TSTypeLiteral: check,
      TSTypeReference: check,
    };
  },
  defaultOptions: [],
  meta: {
    messages: { unsafeDictionary: MESSAGE },
    schema: [],
    type: "problem",
  },
};
