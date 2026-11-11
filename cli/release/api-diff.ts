import fs from "node:fs";
import path from "node:path";

import ts from "typescript";

import { classify } from "./api-diff-compare.ts";
import type { Ctx } from "./api-diff-nominal.ts";
import { ENTRY_FILE, noModule } from "./api-diff.constants.ts";
import { TSCONFIG, TYPE_IMPORT } from "./consumer.constants.ts";
import { exportSubpaths } from "./exports.ts";
import type { Subpath } from "./exports.ts";
import { specOf } from "./install.ts";
import type { Package } from "./install.ts";

/** One version of the package: the name it is imported by in the project, and its subpaths. */
export type Side = { name: string; subpaths: Subpath[] };
/** One public name, or a whole subpath when `name` is null, that was added, removed, widened or narrowed. */
export type Change = { key: string; name: string | null; kind: "added" | "removed" | "widened" | "narrowed" };

/** The exports of a module by name, with aliases (`export { x }`, `export type { T }`) followed to what they stand for. */
type Names = Map<string, ts.Symbol>;

/** The subpaths the checker can read: code that names a types file. */
const typed = (side: Side): Subpath[] =>
  side.subpaths.filter((subpath) => subpath.kind === "code" && subpath.types !== null);

/** The compiler options of `TSCONFIG`, as `tsc -p` reads them. */
function compilerOptions(project: string): ts.CompilerOptions {
  return ts.parseJsonConfigFileContent(JSON.parse(TSCONFIG), ts.sys, project).options;
}

/** The exports of a module by name. */
function namesOf(checker: ts.TypeChecker, module: ts.Symbol): Names {
  return new Map(
    checker
      .getExportsOfModule(module)
      .map((symbol) => [symbol.name, symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol]),
  );
}

/** The exports of each subpath of one side, by key, read from that side's imports in the entry. */
function modulesOf(ctx: Ctx, imports: readonly ts.ImportDeclaration[], keys: readonly string[]): Map<string, Names> {
  const modules = keys.flatMap((key, index) => imports.slice(index, index + 1).map((decl) => ({ decl, key })));
  return new Map(
    modules.map(({ key, decl }) => {
      const symbol = ctx.checker.getSymbolAtLocation(decl.moduleSpecifier);
      if (symbol === undefined) throw new Error(noModule(decl.moduleSpecifier.getText()));
      return [key, namesOf(ctx.checker, symbol)];
    }),
  );
}

/** The changes of the names of one subpath that both versions export. */
function diffNames(ctx: Ctx, key: string, names: [Names, Names]): Change[] {
  const [old, next] = names;
  const all = [...new Set([...old.keys(), ...next.keys()])].sort();
  return all.flatMap((name): Change[] => {
    const [before, after] = [old.get(name), next.get(name)];
    if (before === undefined) return [{ key, kind: "added", name }];
    if (after === undefined) return [{ key, kind: "removed", name }];
    const kind = classify(ctx, before, after);
    return kind === null ? [] : [{ key, kind, name }];
  });
}

/** Writes the entry file that imports every subpath of both sides, and the program over it. */
function entryProgram(project: string, specs: readonly string[]): ts.Program {
  const entry = path.join(project, ENTRY_FILE);
  fs.writeFileSync(entry, specs.map((spec, index) => TYPE_IMPORT(index, spec)).join(""));
  return ts.createProgram([entry], compilerOptions(project));
}

/** The changes between the exports of each subpath, a subpath on one side only counting as added or removed. */
function diffModules(ctx: Ctx, old: Map<string, Names>, next: Map<string, Names>): Change[] {
  const keys = [...new Set([...old.keys(), ...next.keys()])].sort();
  return keys.flatMap((key): Change[] => {
    const [was, is] = [old.get(key), next.get(key)];
    if (was === undefined) return [{ key, kind: "added", name: null }];
    if (is === undefined) return [{ key, kind: "removed", name: null }];
    return diffNames(ctx, key, [was, is]);
  });
}

/**
 * What changed in the public types between `old` and `next`, both installed in `project`: a subpath or name added or
 * removed, or kept with a type that now asks more of its users (narrowed) or less (widened). Only code subpaths that name
 * a types file are read; JSON and other files are not.
 */
export function apiDiff(project: string, old: Side, next: Side): Change[] {
  const [before, after] = [typed(old), typed(next)];
  const specs = [...before.map((s) => specOf(old.name, s)), ...after.map((s) => specOf(next.name, s))];
  const program = entryProgram(project, specs);
  const ctx: Ctx = { checker: program.getTypeChecker(), packages: [old.name, next.name] };
  const entry = program.getSourceFiles().filter((file) => file.fileName.endsWith(ENTRY_FILE));
  const imports = entry.flatMap((file) => file.statements.filter(ts.isImportDeclaration));
  const was = modulesOf(
    ctx,
    imports,
    before.map((s) => s.key),
  );
  const is = modulesOf(
    ctx,
    imports.slice(before.length),
    after.map((s) => s.key),
  );
  return diffModules(ctx, was, is);
}

/** The side an installed package makes: the name it is imported by and the subpaths its `exports` reach. */
export function sideOf(pkg: Package): Side {
  const files = fs.readdirSync(pkg.root, { recursive: true }).map(String);
  return { name: pkg.name, subpaths: exportSubpaths(pkg.installed.exports, files).subpaths };
}
