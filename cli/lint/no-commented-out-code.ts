import { AST_TOKEN_TYPES } from "@typescript-eslint/utils";
import { parseSync } from "oxc-parser";

import type { RepoRule, RuleComment } from "./rule.types.ts";

const MESSAGE = "this comment is code; delete it, git keeps the old version";

/** Comments a tool reads: type and lint directives, pure marks, and coverage hints. */
const TOOL = /^\s*(?:@ts-|oxlint-|eslint-|[@#]__PURE__|(?:v8|c8|istanbul)\s+ignore\b)/;

/** Two line comments on adjacent lines, with nothing but spaces between them. */
const ADJACENT = /^[ \t]*\r?\n[ \t]*$/;
const BLOCK_STAR = /^[ \t]*\*[ \t]?/gm;

/** What only code holds: a parsed expression or a label alone can be prose like `workspace` or `note: see a.b`. */
const CODE = [
  "AssignmentExpression",
  "CallExpression",
  "ClassDeclaration",
  "DoWhileStatement",
  "ExportAllDeclaration",
  "ExportDefaultDeclaration",
  "ExportNamedDeclaration",
  "ForInStatement",
  "ForOfStatement",
  "ForStatement",
  "FunctionDeclaration",
  "IfStatement",
  "ImportDeclaration",
  "NewExpression",
  "ReturnStatement",
  "SwitchStatement",
  "TSEnumDeclaration",
  "TSInterfaceDeclaration",
  "TSTypeAliasDeclaration",
  "ThrowStatement",
  "TryStatement",
  "VariableDeclaration",
  "WhileStatement",
];

/** JSDoc documents, a triple-slash comment directs the compiler, and a tool comment is read by its tool. */
function skipped(comment: RuleComment): boolean {
  if (comment.type === AST_TOKEN_TYPES.Block && comment.value.startsWith("*")) return true;

  if (comment.type === AST_TOKEN_TYPES.Line && comment.value.startsWith("/")) return true;

  return TOOL.test(comment.value);
}

function joins(text: string, previous: RuleComment, comment: RuleComment): boolean {
  return (
    previous.type === AST_TOKEN_TYPES.Line &&
    comment.type === AST_TOKEN_TYPES.Line &&
    ADJACENT.test(text.slice(previous.range[1], comment.range[0]))
  );
}

type Group = [RuleComment, ...RuleComment[]];

/** The comments to read as one text each: a run of line comments on adjacent lines, or one block comment. */
function groupsOf(text: string, comments: readonly RuleComment[]): Group[] {
  const groups: Group[] = [];
  let open: { group: Group; last: RuleComment } | null = null;

  for (const comment of comments) {
    if (skipped(comment)) {
      open = null;
    } else if (open !== null && joins(text, open.last, comment)) {
      open.group.push(comment);
      open.last = comment;
    } else {
      open = { group: [comment], last: comment };
      groups.push(open.group);
    }
  }

  return groups;
}

function holdsCode(node: unknown): boolean {
  if (typeof node !== "object" || node === null) return false;

  if (Array.isArray(node)) return node.some(holdsCode);

  if ("type" in node && typeof node.type === "string" && CODE.includes(node.type)) return true;

  return Object.values(node).some(holdsCode);
}

/** Whether `source` parses as TypeScript with no error, at module scope or in a function body, and holds code. */
function isCode(source: string): boolean {
  for (const text of [source, `async function* comment() {\n${source}\n}`]) {
    const parsed = parseSync("comment.ts", text, { sourceType: "module" });

    if (parsed.errors.length === 0) return holdsCode(parsed.program.body);
  }

  return false;
}

function textOf(group: readonly RuleComment[]): string {
  return group
    .map((comment) =>
      comment.type === AST_TOKEN_TYPES.Block ? comment.value.replaceAll(BLOCK_STAR, "") : comment.value,
    )
    .join("\n");
}

/** Code as a whole, like a multi-line `if`, or on any one line, like a commented call under a prose line. */
function isCodeGroup(text: string): boolean {
  return isCode(text) || text.split("\n").some(isCode);
}

/**
 * Fails a comment that parses as code: git keeps the old version, so code left in a comment only rots. Consecutive
 * line comments are read as one; JSDoc, triple-slash and tool comments are skipped.
 */
export const noCommentedOutCode: RepoRule<"code"> = {
  create(context) {
    return {
      Program() {
        for (const group of groupsOf(context.sourceCode.text, context.sourceCode.getAllComments()))
          if (isCodeGroup(textOf(group))) context.report({ messageId: "code", node: group[0] });
      },
    };
  },
  defaultOptions: [],
  meta: {
    messages: { code: MESSAGE },
    schema: [],
    type: "problem",
  },
};
