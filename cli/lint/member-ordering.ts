import type { CreateRule, ESTree } from "@oxlint/plugins";

type Member = ESTree.ClassElement;
type Method = ESTree.MethodDefinition;
type Field = Exclude<Member, Method | ESTree.StaticBlock | ESTree.TSIndexSignature>;

/** The order a class reads in, which every message states. */
const ORDER = "order static fields, instance fields, constructor, public methods, non-public methods";
/** Each group's rank in that order. */
const RANK = { constructor: 2, instance: 1, nonPublic: 4, publicMethod: 3, static: 0 } as const;
/** How a message names a member of a group that comes later in the order than the member it reports. */
const LATER: Readonly<Record<number, string>> = {
  [RANK.instance]: "an instance field",
  [RANK.constructor]: "the constructor",
  [RANK.publicMethod]: "a public method",
  [RANK.nonPublic]: "a non-public method",
};

/** A member's group in the order, and how a message names it. */
type Placed = { rank: number; label: string };

/** The name a message gives a member's key, after a space: `x`, `#x` or a string key; empty for a computed one. */
function keyOf(member: Method | Field): string {
  if (member.computed) return "";
  const { key } = member;
  if (key.type === "Identifier") return ` \`${key.name}\``;
  if (key.type === "PrivateIdentifier") return ` \`#${key.name}\``;
  return key.type === "Literal" ? ` \`${String(key.value)}\`` : "";
}

/** Where a method goes: the constructor, a public method, or a `protected`, `private` or `#x` one. */
function methodPlace(member: Method): Placed {
  if (member.kind === "constructor") return { label: "the constructor", rank: RANK.constructor };
  const isNonPublic = member.key.type === "PrivateIdentifier" || (member.accessibility ?? "public") !== "public";
  const label = `the ${isNonPublic ? "non-public" : "public"} method${keyOf(member)}`;
  return { label, rank: isNonPublic ? RANK.nonPublic : RANK.publicMethod };
}

/** Where `member` goes in the order; index signatures and static blocks go with the static fields. */
function placeOf(member: Member): Placed {
  if (member.type === "TSIndexSignature") return { label: "the index signature", rank: RANK.static };
  if (member.type === "StaticBlock") return { label: "the static block", rank: RANK.static };
  if (member.type === "MethodDefinition" || member.type === "TSAbstractMethodDefinition") return methodPlace(member);
  const label = `the ${member.static ? "static" : "instance"} field${keyOf(member)}`;
  return { label, rank: member.static ? RANK.static : RANK.instance };
}

/**
 * Fails a class member placed after a member of a later group, so every class reads in one order: index signatures,
 * static fields and static blocks; instance fields, `accessor` ones too; the constructor; public methods, with
 * getters, setters, static and abstract ones; then `protected`, `private` and `#x` methods. Overloads rank with
 * their method, and parameter properties are not members. Reports only; it never moves a member.
 */
export const memberOrdering: CreateRule = {
  create(context) {
    return {
      ClassBody(body) {
        let latest: number = RANK.static;
        for (const member of body.body) {
          const { label, rank } = placeOf(member);
          const message = `${label} comes after ${LATER[latest]}; ${ORDER}`;
          if (rank < latest) context.report({ message, node: member });
          latest = Math.max(latest, rank);
        }
      },
    };
  },
};
