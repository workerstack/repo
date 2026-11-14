/** The oxc node types the recursive-remove check reads. */
export const NODE = {
  call: "CallExpression",
  identifier: "Identifier",
  member: "MemberExpression",
  object: "ObjectExpression",
} as const;

/** The fs calls that remove a path. */
export const REMOVES: ReadonlySet<string> = /* @__PURE__ */ new Set(["rm", "rmSync"]);

/** The option key that makes a remove walk a tree. */
export const RECURSIVE = "recursive";
