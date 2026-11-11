import path from "node:path";

import type { ESTree, CreateRule } from "@oxlint/plugins";

import { nearestManifest, readManifest } from "./manifest.ts";
import type { Statement } from "./names.ts";

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

const importsMain = (program: ESTree.Program): boolean =>
  program.body.some(
    (statement) =>
      statement.type === "ImportDeclaration" && statement.specifiers.some((item) => item.local.name === "main"),
  );

/** `main(…)`, `await main(…)` or `void main(…)` as a statement. */
function callsMain(statement: Statement): boolean {
  if (statement.type !== "ExpressionStatement") return false;
  let call = statement.expression;
  if (call.type === "AwaitExpression" || (call.type === "UnaryExpression" && call.operator === "void"))
    call = call.argument;
  return call.type === "CallExpression" && call.callee.type === "Identifier" && call.callee.name === "main";
}

/**
 * Fails a file its nearest package.json lists as a `bin` unless it holds only imports and one call of an imported
 * `main`, so what the program does lives in a module a test can import. A file whose manifest is unreadable is skipped.
 */
export const entryFile: CreateRule = {
  create(context) {
    if (!isBin(context.filename)) return {};
    return {
      Program(program) {
        const imported = importsMain(program);
        let called = false;
        for (const statement of program.body) {
          if (statement.type === "ImportDeclaration") continue;
          if (imported && !called && callsMain(statement)) called = true;
          else context.report({ message: MESSAGE, node: statement });
        }
        if (!called) context.report({ message: MISSING, node: program });
      },
    };
  },
};
