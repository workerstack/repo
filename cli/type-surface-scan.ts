/**
 * The packages a set of declaration files uses: the packages their bare specifiers name, those their
 * `/// <reference types>` directives resolve into, and those that declare an identifier they mention.
 */
import ts from "typescript";

import type { Locator } from "./package-locator.ts";
import { BARE_SPECIFIER } from "./type-surface.constants.ts";

/** What a scan finds, by package-relative file name: the packages it uses, and the package files it imports. */
export type Scan = { used: Map<string, Set<string>>; links: Map<string, string[]> };

/**
 * What one file's scan reports: a package it uses (null for none), and a file it imports, which is true when own; and
 * the package a file belongs to.
 */
type Found = {
  use: (name: string | null) => void;
  link: (file: string | undefined) => boolean;
  packageOf: Locator["packageOf"];
};

/** Whether a string is the specifier of an import, an export or an `import()` type. */
function isSpecifier({ parent }: ts.StringLiteral): boolean {
  if (ts.isLiteralTypeNode(parent)) return ts.isImportTypeNode(parent.parent);

  return ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent);
}

/** The symbol a node names, followed through an import alias. */
function targetOf(node: ts.Node, checker: ts.TypeChecker): ts.Symbol | undefined {
  const symbol = checker.getSymbolAtLocation(node);
  const aliased = symbol !== undefined && (symbol.flags & ts.SymbolFlags.Alias) !== 0;

  return aliased ? checker.getAliasedSymbol(symbol) : symbol;
}

/** The files declaring what a node names. */
function declaringFiles(node: ts.Node, checker: ts.TypeChecker): ts.SourceFile[] {
  return (targetOf(node, checker)?.declarations ?? []).map((declaration) => declaration.getSourceFile());
}

/** The packages declaring what an identifier names; none when a default lib declares it too, as ts-reset augments. */
function declaringPackages(node: ts.Identifier, program: ts.Program, found: Found): (string | null)[] {
  const files = declaringFiles(node, program.getTypeChecker());

  if (files.some((file) => program.isSourceFileDefaultLibrary(file))) return [];

  return files.map((file) => found.packageOf(file.fileName));
}

function scanFile(file: ts.SourceFile, program: ts.Program, found: Found): void {
  function visit(node: ts.Node): void {
    if (ts.isIdentifier(node)) for (const name of declaringPackages(node, program, found)) found.use(name);

    if (ts.isStringLiteral(node) && isSpecifier(node)) {
      // A self-import, paths alias or `#` import of an own file names no package.
      const isOwn = found.link(declaringFiles(node, program.getTypeChecker())[0]?.fileName);

      if (!isOwn) found.use(BARE_SPECIFIER.exec(node.text)?.[1] ?? null);
    }

    ts.forEachChild(node, visit);
  }

  visit(file);
  const options = program.getCompilerOptions();

  for (const { fileName } of file.typeReferenceDirectives) {
    const resolved = ts.resolveTypeReferenceDirective(fileName, file.fileName, options, ts.sys);
    const target = resolved.resolvedTypeReferenceDirective?.resolvedFileName;

    if (target !== undefined) found.use(found.packageOf(target));
  }
}

/** What the program's own files use and import, by their package-relative names. */
export function scanProgram(program: ts.Program, { ownName, packageOf }: Locator): Scan {
  const scan: Scan = { links: new Map(), used: new Map() };

  for (const file of program.getSourceFiles()) {
    const name = ownName(file.fileName);

    if (name === null) continue;

    scanFile(file, program, {
      link: (target) => {
        const linked = ownName(target ?? "");

        if (linked !== null) scan.links.set(name, [...(scan.links.get(name) ?? []), linked]);

        return linked !== null;
      },
      packageOf,
      use: (pkg) => {
        if (pkg !== null) scan.used.set(pkg, (scan.used.get(pkg) ?? new Set<string>()).add(name));
      },
    });
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
