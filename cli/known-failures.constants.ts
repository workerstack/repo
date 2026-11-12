/** The names the known-failures list and its check share. */

/** Where the list lives unless the config says otherwise. */
export const DEFAULT_LIST = "known-failures.json";

/** Joins the file, the describe titles and the case title into one entry. */
export const SEPARATOR = " > ";

/** The modifier that marks a case expected to fail. */
export const FAILS = "fails";

/** The suite function whose title joins the names. */
export const DESCRIBE = "describe";

/** The test functions that carry `.fails`. */
export const TEST_ROOTS: readonly string[] = ["it", "test"];

/** Files worth parsing: ts tsx mts cts js jsx mjs cjs. */
export const SOURCE: RegExp = /\.(?:[jt]sx?|[cm][jt]s)$/;

/** The oxc node types the walk reads. */
export const NODE = {
  call: "CallExpression",
  identifier: "Identifier",
  literal: "Literal",
  member: "MemberExpression",
  template: "TemplateLiteral",
} as const;
