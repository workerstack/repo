/** Ported from anti-slop (MIT, see anti-slop.LICENSE): `src/rules/no-shape-in-symbol-names.ts`. */
import { AST_NODE_TYPES, type TSESTree } from "@typescript-eslint/utils";

import type { RepoRule } from "./rule.types.ts";

const FORBIDDEN = "shape";

const MESSAGE = 'Rename symbol "{{name}}" for its domain role; "shape" describes structure rather than ownership.';

type NamedNode = TSESTree.Identifier | TSESTree.JSXIdentifier | TSESTree.PrivateIdentifier;

/**
 * Whether `node` is the property of a non-computed member read, a name another value owns. A name always has a
 * parent, under oxlint too: only the Program's is null.
 */
function isBorrowedMemberName(node: NamedNode): boolean {
  const { parent } = node;

  return parent.type === AST_NODE_TYPES.MemberExpression && parent.property === node && !parent.computed;
}

/**
 * Fails an identifier, private name or JSX name holding "shape" in any case, as `TOKEN_SHAPE` or `#shape`: the word
 * names a value's structure, not the role it plays. The property of a non-computed member read, as zod's
 * `schema.shape`, passes, because another value owns that name.
 */
export const noForbiddenTermInSymbolNames: RepoRule<"forbiddenSymbolName"> = {
  create(context) {
    function check(node: NamedNode): void {
      if (!node.name.toLowerCase().includes(FORBIDDEN) || isBorrowedMemberName(node)) return;

      context.report({ data: { name: node.name }, messageId: "forbiddenSymbolName", node });
    }

    return { Identifier: check, JSXIdentifier: check, PrivateIdentifier: check };
  },
  defaultOptions: [],
  meta: {
    messages: { forbiddenSymbolName: MESSAGE },
    schema: [],
    type: "problem",
  },
};
