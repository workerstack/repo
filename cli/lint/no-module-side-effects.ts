import { AST_NODE_TYPES, type TSESLint, type TSESTree } from "@typescript-eslint/utils";

import { PARENT_KEY } from "./max-line-width.constants.ts";
import type { RepoRule } from "./rule.types.ts";

// `"sideEffects": false` is only true when importing a module runs nothing. A bundler keeps any top-level code it
// cannot prove pure, so module scope only declares; a call it needs is marked pure or moved into a function.
const MESSAGE = "module scope runs no code; move this into a function, or mark a pure call /* @__PURE__ */";

/** Statements that only declare. A class is walked instead: its decorators, heritage and static parts run. */
const DECLARATIONS = [
  "EmptyStatement",
  "ExportAllDeclaration",
  "FunctionDeclaration",
  "ImportDeclaration",
  "TSDeclareFunction",
  "TSEnumDeclaration",
  "TSExportAssignment",
  "TSImportEqualsDeclaration",
  "TSInterfaceDeclaration",
  "TSModuleDeclaration",
  "TSTypeAliasDeclaration",
];

const EFFECTS = [
  "AssignmentExpression",
  "AwaitExpression",
  "CallExpression",
  "NewExpression",
  "TaggedTemplateExpression",
  "UpdateExpression",
  "YieldExpression",
];

/** Code inside a function runs when it is called, not at import. */
const FUNCTIONS = ["ArrowFunctionExpression", "FunctionDeclaration", "FunctionExpression"];
const PURE = /[@#]__PURE__/;

type Node = TSESTree.Node;

type Context = TSESLint.RuleContext<"effect", []>;

type Field = TSESTree.PropertyDefinition | TSESTree.AccessorProperty;

function isNode(value: unknown): value is Node {
  return typeof value === "object" && value !== null && "type" in value && typeof value.type === "string";
}

function isField(node: Node): node is Field {
  return node.type.endsWith("PropertyDefinition") || node.type.endsWith("AccessorProperty");
}

function children(node: Node): Node[] {
  const entries: [string, unknown][] = Object.entries(node);

  return entries.flatMap(([key, value]) => (key === PARENT_KEY ? [] : [value].flat().filter(isNode)));
}

function firstOf<T>(items: readonly T[], find: (item: T) => Node | null): Node | null {
  for (const item of items) {
    const found = find(item);

    if (found !== null) return found;
  }

  return null;
}

function pure(context: Context, node: Node): boolean {
  return context.sourceCode.getCommentsBefore(node).some((comment) => PURE.test(comment.value));
}

/** The first node under `node` that runs at import: a non-pure effect, a decorator, or a static part's code. */
function firstEffect(context: Context, node: Node | null): Node | null {
  if (node === null || FUNCTIONS.includes(node.type)) return null;

  if (node.type === AST_NODE_TYPES.Decorator) return node;

  if (node.type === AST_NODE_TYPES.StaticBlock)
    return firstOf(node.body, (statement) => statementEffect(context, statement));
  // An instance field's value runs per construction; its decorators and computed key run with the class.
  const parts = isField(node) && !node.static ? [...node.decorators, node.key] : children(node);

  if (EFFECTS.includes(node.type) && !pure(context, node)) return node;

  return firstOf(parts, (child) => firstEffect(context, child));
}

/** What a module-scope statement runs at import, or null when it only declares. */
function statementEffect(context: Context, statement: Node): Node | null {
  const inner = statement.type === AST_NODE_TYPES.ExportNamedDeclaration ? statement.declaration : statement;

  if (inner === null || DECLARATIONS.includes(inner.type)) return null;

  if (inner.type === AST_NODE_TYPES.ExpressionStatement && (inner.directive ?? undefined) !== undefined) return null;

  if (inner.type === AST_NODE_TYPES.VariableDeclaration)
    return firstOf(inner.declarations, (item) => firstEffect(context, item.init));

  if (inner.type === AST_NODE_TYPES.ExportDefaultDeclaration || inner.type === AST_NODE_TYPES.ClassDeclaration)
    return firstEffect(context, inner);

  return inner;
}

/** Fails module-scope code that runs at import, reported on the first such node of each statement. */
export const noModuleSideEffects: RepoRule<"effect"> = {
  create(context) {
    return {
      Program(program) {
        for (const statement of program.body) {
          const effect = statementEffect(context, statement);

          if (effect !== null) context.report({ messageId: "effect", node: effect });
        }
      },
    };
  },
  defaultOptions: [],
  meta: {
    messages: { effect: MESSAGE },
    schema: [],
    type: "problem",
  },
};
