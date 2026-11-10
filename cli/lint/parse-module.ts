/** Reads one source file into the names it exports, imports and declares. */
import { parseSync } from "oxc-parser";
import { DEFAULT, NAMESPACE, NODE } from "./public-surface.constants.ts";
import { asNode, declaredNames, get, nameOf, nodesOf, sourceText, unknownForm } from "./public-surface.syntax.ts";
import type { Module, Node } from "./public-surface.types.ts";

function importedName(specifier: Node): string {
  if (specifier["type"] === NODE.importNamespace) return NAMESPACE;
  if (specifier["type"] === NODE.importDefault) return DEFAULT;
  return nameOf(specifier["imported"]);
}

function addImports(module: Module, statement: Node): void {
  for (const specifier of nodesOf(statement["specifiers"])) {
    module.imports.set(nameOf(specifier["local"]), { name: importedName(specifier), source: sourceText(statement) });
  }
}

function addDefault(module: Module, statement: Node): void {
  const declaration = statement["declaration"];
  const identifier = get(declaration, "type") === NODE.identifier ? nameOf(declaration) : null;
  const local = declaredNames(statement)[0] ?? identifier;
  if (local === null) module.unknown.push({ form: String(get(declaration, "type")), at: Number(statement["start"]) });
  else module.exports.set(DEFAULT, { name: local, source: null });
}

function addExports(module: Module, statement: Node): void {
  const source = asNode(statement["source"]) === null ? null : sourceText(statement);
  if (statement["type"] === NODE.exportAll) {
    if (asNode(statement["exported"]) !== null)
      module.exports.set(nameOf(statement["exported"]), { name: NAMESPACE, source });
    else module.stars.push({ source: sourceText(statement), at: Number(statement["start"]) });
    return;
  }
  if (statement["type"] === NODE.exportDefault) return addDefault(module, statement);
  for (const name of declaredNames(statement)) module.exports.set(name, { name, source: null });
  for (const specifier of nodesOf(statement["specifiers"])) {
    module.exports.set(nameOf(specifier["exported"]), { name: nameOf(specifier["local"]), source });
  }
}

/** The module `code` of `file` declares. */
export function parseModule(file: string, code: string): Module {
  const module: Module = {
    file,
    code,
    exports: new Map(),
    imports: new Map(),
    locals: new Map(),
    stars: [],
    unknown: [],
  };
  for (const statement of nodesOf(parseSync(file, code).program.body)) {
    const type = String(statement["type"]);
    if (type === NODE.importDeclaration) addImports(module, statement);
    if (type.startsWith("Export")) addExports(module, statement);
    for (const name of declaredNames(statement)) {
      module.locals.set(name, [...(module.locals.get(name) ?? []), statement]);
    }
    const form = unknownForm(statement);
    if (form !== null) module.unknown.push({ form, at: Number(statement["start"]) });
  }
  return module;
}
