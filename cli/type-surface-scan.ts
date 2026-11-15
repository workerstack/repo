/**
 * The packages a set of declaration files uses: the packages their bare specifiers name, those their
 * `/// <reference types>` directives resolve into, and those that declare an identifier they mention.
 */
import type { Identifier, Node, SourceFile, StringLiteral } from "typescript/unstable/ast";
import {
  isExportDeclaration,
  isIdentifier,
  isImportDeclaration,
  isImportTypeNode,
  isLiteralTypeNode,
  isStringLiteral,
} from "typescript/unstable/ast/is";
import { SymbolFlags } from "typescript/unstable/async";
import type { Project, Symbol as TsSymbol } from "typescript/unstable/async";

import type { Locator } from "./package-locator.ts";
import { BARE_SPECIFIER, TYPES_SCOPE } from "./type-surface.constants.ts";

/** What a scan finds, by package-relative file name: the packages it uses, and the package files it imports. */
export type Scan = { used: Map<string, Set<string>>; links: Map<string, string[]> };

/** A declaring file: its name, and whether a default library it is, such as `lib.dom.d.ts`. */
type Declaring = { fileName: string; isLibrary: boolean };

/**
 * What a scan reads through and writes to: the project, the locator, the files each symbol is declared in as read,
 * the packages the project holds files of, and the scan so far.
 */
type Reader = {
  project: Project;
  locator: Locator;
  declaring: Map<TsSymbol, Declaring[]>;
  present: Set<string>;
  scan: Scan;
};

/** One own file being scanned: the reader, and the file's package-relative name. */
type At = { reader: Reader; name: string };

/** Whether a string is the specifier of an import, an export or an `import()` type. */
export function isSpecifier({ parent }: StringLiteral): boolean {
  if (isLiteralTypeNode(parent)) return isImportTypeNode(parent.parent);

  return isImportDeclaration(parent) || isExportDeclaration(parent);
}

/** The identifiers and module specifiers of a file, in source order. */
function namesOf(file: SourceFile): (Identifier | StringLiteral)[] {
  const nodes: (Identifier | StringLiteral)[] = [];

  function visit(node: Node): void {
    if (isIdentifier(node) || (isStringLiteral(node) && isSpecifier(node))) nodes.push(node);
    node.forEachChild(visit);
  }

  visit(file);

  return nodes;
}

/** The files declaring a symbol, followed through an import alias. */
async function declaringFiles(reader: Reader, symbol: TsSymbol | undefined): Promise<Declaring[]> {
  if (symbol === undefined) return [];
  const known = reader.declaring.get(symbol);

  if (known !== undefined) return known;
  const { checker, program } = reader.project;
  const target = (symbol.flags & SymbolFlags.Alias) === 0 ? symbol : await checker.getAliasedSymbol(symbol);
  const files: Declaring[] = [];

  const nodes = [];

  for (const handle of target.declarations) nodes.push(await handle.resolve(reader.project));

  for (const node of nodes.filter((each) => each !== undefined)) {
    const file = node.getSourceFile();
    files.push({ fileName: file.fileName, isLibrary: await program.isSourceFileDefaultLibrary(file) });
  }

  reader.declaring.set(symbol, files);

  return files;
}

/** The package a `/// <reference types="name">` reaches: `@types/name` when the project holds it, else `name`. */
function referencedPackage(reader: Reader, name: string): string | null {
  const typed = `${TYPES_SCOPE}${name.startsWith("@") ? name.slice(1).replace("/", "__") : name}`;

  return [typed, name].find((pkg) => reader.present.has(pkg)) ?? null;
}

/** Records that the file `at` names uses `pkg`; nothing for no package. */
function use({ reader, name }: At, pkg: string | null): void {
  const { used } = reader.scan;

  if (pkg !== null) used.set(pkg, (used.get(pkg) ?? new Set<string>()).add(name));
}

/** What one identifier or specifier of an own file uses or links, given the files its symbol is declared in. */
function scanName(at: At, node: Identifier | StringLiteral, files: readonly Declaring[]): void {
  if (isIdentifier(node)) {
    const isGlobal = files.some((each) => each.isLibrary);

    if (!isGlobal) for (const each of files) use(at, at.reader.locator.packageOf(each.fileName));

    return;
  }

  // A self-import, paths alias or `#` import of an own file names no package.
  const linked = at.reader.locator.ownName(files[0]?.fileName ?? "");

  if (linked === null) {
    use(at, BARE_SPECIFIER.exec(node.text)?.[1] ?? null);

    return;
  }

  const { links } = at.reader.scan;
  links.set(at.name, [...(links.get(at.name) ?? []), linked]);
}

/** What one own file uses and links, recorded in the reader's scan. */
async function scanFile(reader: Reader, file: SourceFile, name: string): Promise<void> {
  const at = { name, reader };
  const nodes = namesOf(file);
  const symbols = await reader.project.checker.getSymbolAtLocation(nodes);

  for (const [index, node] of nodes.entries()) scanName(at, node, await declaringFiles(reader, symbols[index]));

  for (const { fileName } of file.typeReferenceDirectives) use(at, referencedPackage(reader, fileName));
}

/** What the project's own files use and import, by their package-relative names. */
export async function scanProject(project: Project, locator: Locator): Promise<Scan> {
  const scan: Scan = { links: new Map(), used: new Map() };
  const fileNames = await project.program.getSourceFileNames();
  const present = new Set(fileNames.map((fileName) => locator.packageOf(fileName)).filter((pkg) => pkg !== null));
  const reader: Reader = { declaring: new Map(), locator, present, project, scan };

  for (const fileName of fileNames) {
    const name = locator.ownName(fileName);
    const file = name === null ? undefined : await project.program.getSourceFile(fileName);

    if (name !== null && file !== undefined) await scanFile(reader, file, name);
  }

  return scan;
}

/** Each file the roots reach with the key of the nearest root, the earlier root winning a tie. */
export function keysOf(links: Scan["links"], roots: readonly (readonly [string, string])[]): Map<string, string> {
  const keys = new Map<string, string>();
  const queue = [...roots];

  for (const [name, key] of queue) {
    if (keys.has(name)) continue;
    keys.set(name, key);
    queue.push(...(links.get(name) ?? []).map((child) => [child, key] as const));
  }

  return keys;
}
