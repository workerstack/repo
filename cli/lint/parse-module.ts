/** Reads one source file into the names it exports, imports and declares. */
import { parseSync } from "oxc-parser";

import { asNode, type SyntaxNode } from "../syntax-node.ts";
import { DEFAULT, NAMESPACE, NODE } from "./public-surface.constants.ts";
import { declaredNames, get, nameOf, nodesOf, sourceText, unknownForm } from "./public-surface.syntax.ts";
import type { Module } from "./public-surface.types.ts";

function importedName(specifier: SyntaxNode): string {
  if (specifier["type"] === NODE.importNamespace) return NAMESPACE;

  if (specifier["type"] === NODE.importDefault) return DEFAULT;

  return nameOf(specifier["imported"]);
}

function addImports(module: Module, statement: SyntaxNode): void {
  for (const specifier of nodesOf(statement["specifiers"]))
    module.imports.set(nameOf(specifier["local"]), { name: importedName(specifier), source: sourceText(statement) });
}

function addDefault(module: Module, statement: SyntaxNode): void {
  const declaration = statement["declaration"];
  const identifier = get(declaration, "type") === NODE.identifier ? nameOf(declaration) : null;
  const local = declaredNames(statement)[0] ?? identifier;

  if (local === null) module.unknown.push({ at: Number(statement["start"]), form: String(get(declaration, "type")) });
  else module.exports.set(DEFAULT, { name: local, source: null });
}

function addExports(module: Module, statement: SyntaxNode): void {
  const source = asNode(statement["source"]) === null ? null : sourceText(statement);

  if (statement["type"] === NODE.exportAll) {
    if (asNode(statement["exported"]) === null)
      module.stars.push({ at: Number(statement["start"]), source: sourceText(statement) });
    else module.exports.set(nameOf(statement["exported"]), { name: NAMESPACE, source });

    return;
  }

  if (statement["type"] === NODE.exportDefault) return addDefault(module, statement);

  for (const name of declaredNames(statement)) module.exports.set(name, { name, source: null });

  for (const specifier of nodesOf(statement["specifiers"]))
    module.exports.set(nameOf(specifier["exported"]), { name: nameOf(specifier["local"]), source });
}

/** The module `code` of `file` declares. */
export function parseModule(file: string, code: string): Module {
  const module: Module = {
    code,
    exports: new Map(),
    file,
    imports: new Map(),
    locals: new Map(),
    stars: [],
    unknown: [],
  };

  for (const statement of nodesOf(parseSync(file, code).program.body)) {
    const type = String(get(statement, "type"));

    if (type === NODE.importDeclaration) addImports(module, statement);

    if (type.startsWith("Export")) addExports(module, statement);

    for (const name of declaredNames(statement))
      module.locals.set(name, [...(module.locals.get(name) ?? []), statement]);

    const form = unknownForm(statement);

    if (form !== null) module.unknown.push({ at: Number(statement["start"]), form });
  }

  return module;
}
