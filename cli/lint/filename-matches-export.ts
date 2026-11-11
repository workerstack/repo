import path from "node:path";

import type { ESTree, CreateRule } from "@oxlint/plugins";

import { declaredNames } from "./names.ts";

/** Index files collect, declaration files describe, and test files test: none is named after one export. */
const SKIPPED = /^index\.|\.d\.[cm]?ts$|\.(?:test|spec|e2e)\./;

/** An entry or bin file's `main` is named by its role, not its file; the entry rule governs those. */
const ENTRY_EXPORT = "main";

type Node = ESTree.Node;

const exportedName = (name: ESTree.ModuleExportName): string =>
  name.type === "Identifier" ? name.name : String(name.value);

/** The names a statement exports, or null when it re-exports a module's every name; `export default` adds none. */
function exportsOf(statement: Node): string[] | null {
  if (statement.type === "ExportAllDeclaration")
    return statement.exported === null ? null : [exportedName(statement.exported)];
  if (statement.type !== "ExportNamedDeclaration") return [];
  if (statement.declaration !== null) return declaredNames(statement.declaration);
  return statement.specifiers.map((specifier) => exportedName(specifier.exported));
}

const letters = (name: string): string => name.toLowerCase().replaceAll(/[^a-z\d]/g, "");
const kebab = (name: string): string =>
  name
    .replaceAll(/([a-z\d])([A-Z])/g, "$1-$2")
    .replaceAll(/([A-Z]+)([A-Z][a-z])/g, "$1-$2")
    .replaceAll(/[^A-Za-z\d]+/g, "-")
    .toLowerCase();

/** The one name `program` exports, or null when it exports none, several, or an unknown set. */
function soleExport(program: ESTree.Program): string | null {
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
export const filenameMatchesExport: CreateRule = {
  create(context) {
    const base = path.basename(context.filename);
    if (SKIPPED.test(base)) return {};
    // oxlint lints only files with an extension, so the name has a dot.
    const stem = base.slice(0, base.indexOf("."));
    return {
      Program(program) {
        const name = soleExport(program);
        if (name === null || name === ENTRY_EXPORT || letters(name) === letters(stem)) return;
        const message = `${base} exports only "${name}"; rename the file ${kebab(name)}${base.slice(stem.length)}`;
        context.report({ message, node: program });
      },
    };
  },
};
