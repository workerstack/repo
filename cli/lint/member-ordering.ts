import { AST_NODE_TYPES, type TSESTree } from "@typescript-eslint/utils";

import { asNode } from "../syntax-node.ts";
import { nameOf } from "./public-surface.syntax.ts";
import type { RepoRule } from "./rule.types.ts";

type Member = TSESTree.ClassElement;

type Method = TSESTree.MethodDefinition | TSESTree.TSAbstractMethodDefinition;

type Field = Exclude<Member, Method | TSESTree.StaticBlock | TSESTree.TSIndexSignature>;

/** The order a class reads in, which every message states. */
const ORDER = "order static fields, instance fields, constructor, public methods, non-public methods";

/** Each group's rank in that order. */
const RANK = { constructor: 2, instance: 1, nonPublic: 4, publicMethod: 3, static: 0 } as const;

/** A group's rank in the order. */
type Rank = (typeof RANK)[keyof typeof RANK];

/** How a message names a member of a group that comes later in the order than the member it reports. */
const LATER = {
  [RANK.static]: "a static field",
  [RANK.instance]: "an instance field",
  [RANK.constructor]: "the constructor",
  [RANK.publicMethod]: "a public method",
  [RANK.nonPublic]: "a non-public method",
} as const satisfies Readonly<Record<Rank, string>>;

/** A member's group in the order, and how a message names it. */
type Placed = { rank: Rank; label: string };

/** The name a message gives a member's key, after a space: `x`, `#x` or a string key; empty for a computed one. */
function keyOf(member: Method | Field): string {
  if (member.computed) return "";
  // A key that is not computed is an identifier, a `#x` or a string or number literal.
  const hash = member.key.type === AST_NODE_TYPES.PrivateIdentifier ? "#" : "";

  return ` \`${hash}${nameOf(asNode(member.key))}\``;
}

/** Where a method goes: the constructor, a public method, or a `protected`, `private` or `#x` one. */
function methodPlace(member: Method): Placed {
  if (member.kind === "constructor") return { label: "the constructor", rank: RANK.constructor };

  const isNonPublic =
    member.key.type === AST_NODE_TYPES.PrivateIdentifier || (member.accessibility ?? "public") !== "public";

  const label = `the ${isNonPublic ? "non-public" : "public"} method${keyOf(member)}`;

  return { label, rank: isNonPublic ? RANK.nonPublic : RANK.publicMethod };
}

/** Where `member` goes in the order; index signatures and static blocks go with the static fields. */
function placeOf(member: Member): Placed {
  if (member.type === AST_NODE_TYPES.TSIndexSignature) return { label: "the index signature", rank: RANK.static };

  if (member.type === AST_NODE_TYPES.StaticBlock) return { label: "the static block", rank: RANK.static };

  if (member.type === AST_NODE_TYPES.MethodDefinition || member.type === AST_NODE_TYPES.TSAbstractMethodDefinition)
    return methodPlace(member);
  const label = `the ${member.static ? "static" : "instance"} field${keyOf(member)}`;

  return { label, rank: member.static ? RANK.static : RANK.instance };
}

/**
 * Fails a class member placed after a member of a later group, so every class reads in one order: index signatures,
 * static fields and static blocks; instance fields, `accessor` ones too; the constructor; public methods, with
 * getters, setters, static and abstract ones; then `protected`, `private` and `#x` methods. Overloads rank with
 * their method, and parameter properties are not members. Reports only; it never moves a member.
 */
export const memberOrdering: RepoRule<"order"> = {
  create(context) {
    return {
      ClassBody(body) {
        let latest: Rank = RANK.static;

        for (const member of body.body) {
          const { label, rank } = placeOf(member);

          const data = { label, later: LATER[latest] };

          if (rank < latest) context.report({ data, messageId: "order", node: member });

          if (rank > latest) latest = rank;
        }
      },
    };
  },
  defaultOptions: [],
  meta: {
    messages: { order: `{{label}} comes after {{later}}; ${ORDER}` },
    schema: [],
    type: "suggestion",
  },
};
