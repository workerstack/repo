import path from "node:path";

import { AST_NODE_TYPES, type TSESTree } from "@typescript-eslint/utils";

import { ENTRY_EXPORT } from "./entry-export.constants.ts";
import { declaredNames } from "./names.ts";
import type { RepoRule } from "./rule.types.ts";

/** Index files collect, declaration files describe, and test files test: none is named after one export. */
const SKIPPED = /^index\.|\.d\.[cm]?ts$|\.(?:test|spec|e2e)\./;

const NON_ALPHANUMERIC = /[^a-z\d]/g;
const LOWER_THEN_UPPER = /([a-z\d])([A-Z])/g;
const ACRONYM_THEN_WORD = /([A-Z]+)([A-Z][a-z])/g;
const NON_WORD_RUN = /[^A-Za-z\d]+/g;

type Node = TSESTree.Node;

function exportedName(name: TSESTree.Identifier | TSESTree.StringLiteral): string {
  return name.type === AST_NODE_TYPES.Identifier ? name.name : name.value;
}

/** The names a statement exports, or null when it re-exports a module's every name; `export default` adds none. */
function exportsOf(statement: Node): string[] | null {
  if (statement.type === AST_NODE_TYPES.ExportAllDeclaration)
    return statement.exported === null ? null : [exportedName(statement.exported)];

  if (statement.type !== AST_NODE_TYPES.ExportNamedDeclaration) return [];

  if (statement.declaration !== null) return declaredNames(statement.declaration);

  return statement.specifiers.map((specifier) => exportedName(specifier.exported));
}

function letters(name: string): string {
  return name.toLowerCase().replaceAll(NON_ALPHANUMERIC, "");
}

function kebab(name: string): string {
  return name
    .replaceAll(LOWER_THEN_UPPER, "$1-$2")
    .replaceAll(ACRONYM_THEN_WORD, "$1-$2")
    .replaceAll(NON_WORD_RUN, "-")
    .toLowerCase();
}

/** The one name `program` exports, or null when it exports none, several, or an unknown set. */
function soleExport(program: TSESTree.Program): string | null {
  const names = new Set<string>();

  for (const statement of program.body) {
    const found = exportsOf(statement);

    if (found === null) return null;

    for (const name of found) names.add(name);
  }

  return names.size === 1 ? [...names].join("") : null;
}

/**
 * Fails a file with exactly one exported name that is not named after it, compared on letters and digits so
 * `read-workspace.ts`, `readWorkspace.ts` and `read_workspace.ts` all match `readWorkspace`.
 */
export const filenameMatchesExport: RepoRule<"rename"> = {
  create(context) {
    const base = path.basename(context.filename);

    if (SKIPPED.test(base)) return {};
    // oxlint lints only files with an extension, so the name has a dot.
    const stem = base.slice(0, base.indexOf("."));

    return {
      Program(program) {
        const name = soleExport(program);

        if (name === null || name === ENTRY_EXPORT || letters(name) === letters(stem)) return;
        const renamed = `${kebab(name)}${base.slice(stem.length)}`;
        context.report({ data: { base, name, renamed }, messageId: "rename", node: program });
      },
    };
  },
  defaultOptions: [],
  meta: {
    messages: { rename: '{{base}} exports only "{{name}}"; rename the file {{renamed}}' },
    schema: [],
    type: "problem",
  },
};
