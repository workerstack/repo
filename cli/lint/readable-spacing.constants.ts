/**
 * The statement kinds `repo/require-readable-spacing` tells apart. Ported from anti-slop (MIT, see
 * anti-slop.LICENSE): `src/rules/require-readable-spacing.ts`, over eslint-stylistic's
 * `padding-line-between-statements` (MIT, see eslint-stylistic.LICENSE). Each kind record maps a node type to the
 * keyword its first token must be, or to null for none.
 */
import { AST_NODE_TYPES } from "@typescript-eslint/utils";

/** An import declaration. */
export const IMPORT_KIND: Partial<Record<AST_NODE_TYPES, string | null>> = {
  [AST_NODE_TYPES.ImportDeclaration]: "import",
};

/** A function, class, interface or type alias: padded on both sides. */
export const DECLARATION_KINDS: Partial<Record<AST_NODE_TYPES, string | null>> = {
  [AST_NODE_TYPES.FunctionDeclaration]: null,
  [AST_NODE_TYPES.ClassDeclaration]: "class",
  [AST_NODE_TYPES.TSInterfaceDeclaration]: "interface",
  [AST_NODE_TYPES.TSTypeAliasDeclaration]: "type",
};

/** A return, if, switch, try, for, while or do statement: padded before. */
export const CONTROL_KINDS: Partial<Record<AST_NODE_TYPES, string | null>> = {
  [AST_NODE_TYPES.ReturnStatement]: "return",
  [AST_NODE_TYPES.IfStatement]: "if",
  [AST_NODE_TYPES.SwitchStatement]: "switch",
  [AST_NODE_TYPES.TryStatement]: "try",
  [AST_NODE_TYPES.ForStatement]: "for",
  [AST_NODE_TYPES.ForInStatement]: "for",
  [AST_NODE_TYPES.ForOfStatement]: "for",
  [AST_NODE_TYPES.WhileStatement]: "while",
  [AST_NODE_TYPES.DoWhileStatement]: "do",
};

/** The first tokens of a `const`, `let` or `var` declaration; a `using` one is told by its kind instead. */
export const BINDING_KEYWORDS: readonly string[] = ["const", "let", "var"];

/** The kinds of a `using` declaration. */
export const USING_KINDS: readonly string[] = ["using", "await using"];

/** A function, the callee that makes a call an IIFE. */
export const FUNCTION_TYPES: readonly AST_NODE_TYPES[] = [
  AST_NODE_TYPES.FunctionDeclaration,
  AST_NODE_TYPES.FunctionExpression,
  AST_NODE_TYPES.ArrowFunctionExpression,
];

/** The nodes whose closing brace makes a statement that ends in it block-like. */
export const BLOCK_OWNERS: readonly AST_NODE_TYPES[] = [AST_NODE_TYPES.BlockStatement, AST_NODE_TYPES.SwitchStatement];

/** The statements an overload may be followed by and stay grouped with. */
export const OVERLOAD_FOLLOWERS: readonly AST_NODE_TYPES[] = [
  AST_NODE_TYPES.TSDeclareFunction,
  AST_NODE_TYPES.FunctionDeclaration,
];

/** The suffixes of the node types esquery's `:statement` matches. */
export const STATEMENT_SUFFIXES: readonly string[] = ["Statement", "Declaration"];

export const CLOSING_BRACE = "}";
export const SEMICOLON = ";";

/** Fix text: a newline after prev's last token, or two when next starts on that same line. */
export const NEWLINE = "\n";
export const TWO_NEWLINES = "\n\n";

/** Lines a gap must span to hold a blank line. */
export const PADDING_LINES = 2;
