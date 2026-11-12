/**
 * The TS AST reads `bun repo env migrate` shares between its rewrite, its facts and its main: which module specifiers
 * name the old package, the names a file imports from it (named, default or namespace), the old name a call calls,
 * the blocks of a createScriptEnv call with `as const`, `satisfies` and parentheses seen through, and the binding a
 * call initializes.
 */
import path from "node:path";

import ts from "typescript";

import { LAST, NAMESPACE, SCOPES, SECRET_CALL } from "./env-command.constants.ts";
import { propertiesOf } from "./env-files.ts";

/** One replacement of a text: the range `[start, end)` becomes `insert`. */
export type Edit = { readonly start: number; readonly end: number; readonly insert: string };

/** A package that defines createScriptEnv: its name, and its folder, repo-relative. */
export type OldPackage = { readonly name: string; readonly dir: string };

const LINE_REST = /^[^\n]*\n?/u;
const RELATIVE = ".";

/** A file's imports from the old modules: the file, the declarations, and local name to imported (`*` a namespace). */
export type Imports = {
  readonly file: string;
  readonly decls: readonly ts.ImportDeclaration[];
  readonly locals: ReadonlyMap<string, string>;
};

/** One member of a block: a spread, or a key and its value (a shorthand's value is the shorthand itself). */
type Member = { readonly spread: true } | { readonly spread: false; readonly key: string; readonly value: ts.Node };

/** One block of a createScriptEnv config and its members. */
export type Block = { readonly block: string; readonly members: readonly Member[] };

/** Where a call is bound: its declaration and the statement that holds it. */
export type Binding = { readonly declaration: ts.VariableDeclaration; readonly statement: ts.VariableStatement };

/** Whether `spec`, imported by `rel`, names one of `packages`: its name, a subpath, or a path into its folder. */
export function isOldSpecifier(rel: string, packages: readonly OldPackage[], spec: string): boolean {
  const joined = `${path.posix.join(path.posix.dirname(rel), spec)}/`;

  return packages.some(
    ({ dir, name }) =>
      spec === name || spec.startsWith(`${name}/`) || (spec.startsWith(RELATIVE) && joined.startsWith(`${dir}/`)),
  );
}

/** The text of a module specifier, its quotes taken off. */
export function specifierOf(decl: ts.ImportDeclaration): string {
  return decl.moduleSpecifier.getText().slice(1, LAST);
}

/** The named imports of `decl`; none for a default or namespace import. */
export function elementsOf(decl: ts.ImportDeclaration): ts.ImportSpecifier[] {
  return [decl.importClause?.namedBindings]
    .filter((node): node is ts.NamedImports => node !== undefined && ts.isNamedImports(node))
    .flatMap((node) => [...node.elements]);
}

/** The local name of `decl`'s namespace import, as a one-item list; empty when it has none. */
export function namespaceOf(decl: ts.ImportDeclaration): string[] {
  return [decl.importClause?.namedBindings]
    .filter((node): node is ts.NamespaceImport => node !== undefined && ts.isNamespaceImport(node))
    .map((node) => node.name.text);
}

/** The name an import specifier takes from its module. */
export function importedOf(element: ts.ImportSpecifier): string {
  return (element.propertyName ?? element.name).text;
}

/** The imports of `source` from `packages`. */
export function importsFrom(source: ts.SourceFile, packages: readonly OldPackage[]): Imports {
  const decls = source.statements
    .filter(ts.isImportDeclaration)
    .filter((decl) => isOldSpecifier(source.fileName, packages, specifierOf(decl)));

  const named = decls.flatMap(elementsOf).map((element): [string, string] => [element.name.text, importedOf(element)]);
  const spaces = decls.flatMap(namespaceOf).map((name): [string, string] => [name, NAMESPACE]);

  return { decls, file: source.fileName, locals: new Map([...named, ...spaces]) };
}

/** The old name `call` calls through `imports`, as `name(` or `ns.name(`; empty when it calls none of them. */
export function calleeOf(call: ts.CallExpression, imports: Imports): string {
  const callee = call.expression;

  if (ts.isPropertyAccessExpression(callee) && imports.locals.get(callee.expression.getText()) === NAMESPACE)
    return callee.name.text;

  return imports.locals.get(callee.getText()) ?? "";
}

/** The first argument of a secret() call, as a one-item list (empty when it has none); undefined for any other node. */
export function secretArgument(node: ts.Node, imports: Imports): readonly ts.Node[] | undefined {
  return ts.isCallExpression(node) && calleeOf(node, imports) === SECRET_CALL ? node.arguments.slice(0, 1) : undefined;
}

/** `text` with every edit applied, the last first so each range still points at the original text. */
export function applied(text: string, edits: readonly Edit[]): string {
  const ordered = edits.toSorted((a, b) => b.start - a.start);

  return ordered.reduce((out, { end, insert, start }) => out.slice(0, start) + insert + out.slice(end), text);
}

/** The edit that removes `decl` with its line, and with the blank line after it when it opens its group. */
export function dropped(text: string, decl: ts.ImportDeclaration): Edit {
  const start = text.lastIndexOf("\n", decl.getStart() - 1) + 1;
  const rest = text.slice(decl.end);
  const end = decl.end + rest.length - rest.replace(LINE_REST, "").length;
  const opens = start === 0 || text.slice(0, start).endsWith("\n\n");

  return { end: end + Number(opens && text.startsWith("\n", end)), insert: "", start };
}

/** The text of each string literal among `nodes`. */
export function literalsOf(nodes: readonly ts.Node[]): string[] {
  return nodes.filter(ts.isStringLiteralLike).map((node) => node.text);
}

/** The 1-based line `node` starts on. */
export function lineOf(node: ts.Node): number {
  return node.getSourceFile().getLineAndCharacterOfPosition(node.getStart()).line + 1;
}

/** `node` with its parentheses, `as` and `satisfies` taken off. */
export function unwrapped(node: ts.Node): ts.Node {
  const isWrap = ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression(node);

  return isWrap ? unwrapped(node.expression) : node;
}

/** The outermost of the parentheses, `as` and `satisfies` around `node`; `node` itself when it has none. */
export function outermost(node: ts.Node): ts.Node {
  return unwrapped(node.parent) === unwrapped(node) ? outermost(node.parent) : node;
}

/** The key a member's name spells: its text unquoted, or the source of a computed name. */
function keyOf(name: ts.PropertyName): string {
  return ts.isComputedPropertyName(name) ? name.getText() : name.text;
}

function memberOf(member: ts.ObjectLiteralElementLike): Member {
  if (ts.isSpreadAssignment(member)) return { spread: true };
  const value = ts.isPropertyAssignment(member) ? member.initializer : member;

  return { key: keyOf(member.name), spread: false, value };
}

/** The object literal a createScriptEnv call is given inline, as a one-item list; empty for anything else. */
export function configsOf(call: ts.CallExpression): ts.ObjectLiteralExpression[] {
  return call.arguments.slice(0, 1).map(unwrapped).filter(ts.isObjectLiteralExpression);
}

/** The global and scope blocks a call's inline config holds as object literals, in order. */
export function configBlocks(call: ts.CallExpression): Block[] {
  return configsOf(call).flatMap((config) => {
    const blocks = propertiesOf(config);

    return SCOPES.flatMap((block) =>
      [blocks.get(block)?.initializer]
        .filter((node): node is ts.Expression => node !== undefined)
        .map(unwrapped)
        .filter(ts.isObjectLiteralExpression)
        .map((node) => ({ block, members: node.properties.map(memberOf) })),
    );
  });
}

/** The one-declaration statement `call`, wrappers seen through, initializes; undefined for any other call. */
export function bindingOf(call: ts.CallExpression): Binding | undefined {
  return [outermost(call).parent]
    .filter(ts.isVariableDeclaration)
    .flatMap((declaration) =>
      [declaration.parent.parent].filter(ts.isVariableStatement).map((statement) => ({ declaration, statement })),
    )
    .find(({ statement }) => statement.declarationList.declarations.length === 1);
}

/** Whether `statement` carries `export`. */
export function isExported(statement: ts.VariableStatement): boolean {
  return (statement.modifiers ?? []).some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword);
}
