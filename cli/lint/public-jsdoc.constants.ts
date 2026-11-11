/** The text each fault finishes "`name` is public through "entry" and …" with. */
export const FAULTS = {
  empty: "its JSDoc is empty: say what a caller needs and the type does not",
  inferred: "its type is inferred, so its shape goes unchecked: write the type out",
  missing: "has no JSDoc: add a /** */ block that says what a caller needs and the type does not",
  restates: "its JSDoc only restates the name: say what a caller needs and the type does not",
  sameLine: "its JSDoc shares a line with the code before it, so editors do not show it: put it on its own line",
} as const;
/** The text of a fault for a doc that cites `reference`, which ships to consumers. */
export const INTERNAL_FAULT = (reference: string): string =>
  `its JSDoc cites an internal reference (${reference}), which ships to consumers: say it in their terms`;
/** The report for a form the walk cannot follow, finishing "cannot follow … here, …". */
export const UNKNOWN_FAULT = "here, so what it exposes goes unchecked: write it as a plain export";
/** Words a doc may use without adding anything beyond the name. */
export const STOPWORDS: readonly string[] = [
  "a",
  "an",
  "the",
  "of",
  "for",
  "to",
  "this",
  "that",
  "is",
  "are",
  "value",
  "option",
  "options",
  "returns",
  "type",
  "property",
];
/** A reference to this stack's plans, slices, roadmaps or decisions, which a consumer cannot read. */
export const INTERNAL: RegExp = /\b(?:[Pp]lan|[Ss]lice|[Rr]oadmap) \d+\b|\bD\d+\b/;
/** The name shown for a member whose key cannot be read. */
export const COMPUTED = "(computed)";
/** The label of each signature kind, in place of a member name. */
export const SIGNATURES: Readonly<Record<string, string>> = {
  TSCallSignatureDeclaration: "(call)",
  TSConstructSignatureDeclaration: "(new)",
  TSIndexSignature: "(index)",
};
/** How an `unknown` form from the walk reads in a message. */
export const FORMS: Readonly<Record<string, string>> = {
  ArrayPattern: "a destructured export",
  ObjectPattern: "a destructured export",
  TSExportAssignment: "`export =`",
  TSImportEqualsDeclaration: "an `import x = require()`",
  TSModuleDeclaration: "a namespace",
};
/** Node types that are a named member of a class, interface, type literal or enum. */
export const MEMBERS: readonly string[] = [
  "AccessorProperty",
  "MethodDefinition",
  "PropertyDefinition",
  "TSAbstractMethodDefinition",
  "TSAbstractPropertyDefinition",
  "TSEnumMember",
  "TSMethodSignature",
  "TSPropertySignature",
];
/** Node types that can be read as a literal value. */
export const ARITHMETIC: readonly string[] = ["BinaryExpression", "UnaryExpression"];
/** The `kind` of a method that is not an ordinary one. */
export const KIND = { constructor: "constructor", getter: "get", setter: "set" } as const;
/** The ESTree node types the rule reads. */
export const NODE_TYPES = {
  accessorProperty: "AccessorProperty",
  arrow: "ArrowFunctionExpression",
  asExpression: "TSAsExpression",
  binary: "BinaryExpression",
  block: "Block",
  classBody: "ClassBody",
  conditional: "TSConditionalType",
  emptyBody: "TSEmptyBodyFunctionExpression",
  functionDeclaration: "FunctionDeclaration",
  functionExpression: "FunctionExpression",
  identifier: "Identifier",
  literal: "Literal",
  method: "MethodDefinition",
  parameterProperty: "TSParameterProperty",
  propertyDefinition: "PropertyDefinition",
  satisfies: "TSSatisfiesExpression",
  signature: "TSDeclareFunction",
  template: "TemplateLiteral",
} as const;
