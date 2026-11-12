import path from "node:path";

import { AST_NODE_TYPES, type TSESTree } from "@typescript-eslint/utils";

import { ENTRY_EXPORT } from "./entry-export.constants.ts";
import { nearestManifest, readManifest } from "./manifest.ts";
import type { Statement } from "./names.ts";
import type { RepoRule } from "./rule.types.ts";

const SHAPE = "a bin file holds only imports and one main() call";
const MESSAGE = `${SHAPE}; move this into the module main comes from`;
const MISSING = `${SHAPE}; import main and call it once`;

/** Whether `filename` is a `bin` of its nearest package.json, both resolved from the manifest's dir. */
function isBin(filename: string): boolean {
  const file = nearestManifest(path.dirname(filename));
  const manifest = file === null ? null : readManifest(file);

  if (manifest === null) return false;
  const self = path.resolve(filename);

  return manifest.bins.some((bin) => path.resolve(path.dirname(manifest.file), bin) === self);
}

function importsMain(program: TSESTree.Program): boolean {
  return program.body.some(
    (statement) =>
      statement.type === AST_NODE_TYPES.ImportDeclaration &&
      statement.specifiers.some((item) => item.local.name === ENTRY_EXPORT),
  );
}

/** `main(…)`, `await main(…)` or `void main(…)` as a statement. */
function callsMain(statement: Statement): boolean {
  if (statement.type !== AST_NODE_TYPES.ExpressionStatement) return false;
  let call = statement.expression;

  if (
    call.type === AST_NODE_TYPES.AwaitExpression ||
    (call.type === AST_NODE_TYPES.UnaryExpression && call.operator === "void")
  )
    call = call.argument;

  return (
    call.type === AST_NODE_TYPES.CallExpression &&
    call.callee.type === AST_NODE_TYPES.Identifier &&
    call.callee.name === ENTRY_EXPORT
  );
}

/**
 * Fails a file its nearest package.json lists as a `bin` unless it holds only imports and one call of an imported
 * `main`, so what the program does lives in a module a test can import. A file whose manifest is unreadable is skipped.
 */
export const entryFile: RepoRule<"missing" | "move"> = {
  create(context) {
    if (!isBin(context.filename)) return {};

    return {
      Program(program) {
        const imported = importsMain(program);
        let isCalled = false;

        for (const statement of program.body) {
          if (statement.type === AST_NODE_TYPES.ImportDeclaration) continue;

          if (imported && !isCalled && callsMain(statement)) isCalled = true;
          else context.report({ messageId: "move", node: statement });
        }

        if (!isCalled) context.report({ messageId: "missing", node: program });
      },
    };
  },
  defaultOptions: [],
  meta: {
    messages: { missing: MISSING, move: MESSAGE },
    schema: [],
    type: "problem",
  },
};
