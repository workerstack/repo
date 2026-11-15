import fs from "node:fs";
import path from "node:path";

import type { ImportDeclaration } from "typescript/unstable/ast";
import { isImportDeclaration } from "typescript/unstable/ast/is";
import { SymbolFlags } from "typescript/unstable/async";
import type { Project, Symbol as TsSymbol } from "typescript/unstable/async";

import { withFiles, withTsApi } from "../ts-api.ts";
import { posix } from "../ts-program.ts";
import { classify } from "./api-diff-compare.ts";
import { defined } from "./api-diff-nominal.ts";
import type { Ctx } from "./api-diff-nominal.ts";
import { ENTRY_FILE, noModule } from "./api-diff.constants.ts";
import { TSCONFIG, TSCONFIG_FILE, TYPE_IMPORT } from "./consumer.constants.ts";
import { exportSubpaths } from "./exports.ts";
import type { Subpath } from "./exports.ts";
import { specOf } from "./install.ts";
import type { Package } from "./install.ts";

/** One version of the package: the name it is imported by in the project, and its subpaths. */
export type Side = { name: string; subpaths: Subpath[] };

/** One public name, or a whole subpath when `name` is null, that was added, removed, widened or narrowed. */
export type Change = { key: string; name: string | null; kind: "added" | "removed" | "widened" | "narrowed" };

/** The exports of a module by name, with aliases (`export { x }`, `export type { T }`) followed to their target. */
type Names = Map<string, TsSymbol>;

/** The subpaths the checker can read: code that names a types file. */
function typed(side: Side): Subpath[] {
  return side.subpaths.filter((subpath) => subpath.kind === "code" && subpath.types !== null);
}

/** The exports of a module by name. */
async function namesOf(project: Project, module: TsSymbol): Promise<Names> {
  const names: Names = new Map();

  for (const symbol of await project.checker.getExportsOfModule(module)) {
    const isAlias = (symbol.flags & SymbolFlags.Alias) !== 0;
    names.set(symbol.name, isAlias ? await project.checker.getAliasedSymbol(symbol) : symbol);
  }

  return names;
}

/** The exports of each subpath of both sides, by key, read from the entry's imports in order: old keys, then new. */
async function modulesOf(project: Project, imports: readonly ImportDeclaration[], keys: Keys): Promise<Modules> {
  const specifiers = imports.map((decl) => decl.moduleSpecifier);
  const symbols = await project.checker.getSymbolAtLocation(specifiers);
  const modules: Modules = [new Map(), new Map()];

  for (const [index, key] of [...keys.old, ...keys.next].entries()) {
    const symbol = symbols[index];

    if (symbol === undefined) throw new Error(noModule(String(specifiers[index]?.getText())));
    modules[index < keys.old.length ? 0 : 1].set(key, await namesOf(project, symbol));
  }

  return modules;
}

/** The subpath keys of each side, in the order the entry imports them. */
type Keys = { old: readonly string[]; next: readonly string[] };

/** The exports of each subpath of the old side and of the new one. */
type Modules = [Map<string, Names>, Map<string, Names>];

/** How one name changed: added, removed, or what classify says of the two versions. */
function nameVerdict(
  ctx: Ctx,
  before: TsSymbol | undefined,
  after: TsSymbol | undefined,
): Promise<Change["kind"] | null> {
  if (before === undefined) return Promise.resolve("added");

  if (after === undefined) return Promise.resolve("removed");

  return classify(ctx, before, after);
}

/** The changes of the names of one subpath that both versions export. */
async function diffNames(ctx: Ctx, key: string, names: [Names, Names]): Promise<Change[]> {
  const [old, next] = names;
  const all = [...new Set([...old.keys(), ...next.keys()])].toSorted();
  const changes: Change[] = [];

  for (const name of all) {
    const [before, after] = [old.get(name), next.get(name)];

    const kind = await nameVerdict(ctx, before, after);

    if (kind !== null) changes.push({ key, kind, name });
  }

  return changes;
}

/** The changes of one subpath: added or removed as a whole, or its names' changes when both versions have it. */
function subpathChanges(ctx: Ctx, key: string, [was, is]: [Names | undefined, Names | undefined]): Promise<Change[]> {
  if (was === undefined) return Promise.resolve([{ key, kind: "added", name: null }]);

  if (is === undefined) return Promise.resolve([{ key, kind: "removed", name: null }]);

  return diffNames(ctx, key, [was, is]);
}

/** The changes between the exports of each subpath, a subpath on one side only counting as added or removed. */
async function diffModules(ctx: Ctx, [old, next]: Modules): Promise<Change[]> {
  const keys = [...new Set([...old.keys(), ...next.keys()])].toSorted();
  const changes: Change[] = [];

  for (const key of keys) {
    const [was, is] = [old.get(key), next.get(key)];

    changes.push(...(await subpathChanges(ctx, key, [was, is])));
  }

  return changes;
}

/** Writes the entry file that imports every subpath of both sides, and the config it is checked under. */
function writeEntry(project: string, specs: readonly string[]): void {
  fs.writeFileSync(path.join(project, ENTRY_FILE), specs.map((spec, index) => TYPE_IMPORT(index, spec)).join(""));
  fs.writeFileSync(path.join(project, TSCONFIG_FILE), JSON.stringify({ compilerOptions: TSCONFIG.compilerOptions }));
}

/**
 * What changed in the public types between `old` and `next`, both installed in `project`: a subpath or name added or
 * removed, or kept with a type that now asks more of its users (narrowed) or less (widened). Only code subpaths that
 * name a types file are read; JSON and other files are not.
 */
export function apiDiff(project: string, old: Side, next: Side): Promise<Change[]> {
  const [before, after] = [typed(old), typed(next)];
  writeEntry(project, [...before.map((s) => specOf(old.name, s)), ...after.map((s) => specOf(next.name, s))]);
  const dir = posix(fs.realpathSync(project));
  const keys = { next: after.map((s) => s.key), old: before.map((s) => s.key) };

  return withTsApi(dir, (run) =>
    withFiles(run, { base: TSCONFIG_FILE, dir, files: [ENTRY_FILE] }, async (opened) => {
      const entry = await opened.program.getSourceFile(`${dir}/${ENTRY_FILE}`);
      const imports = [entry].filter(defined).flatMap((file) => file.statements.filter(isImportDeclaration));
      const ctx: Ctx = { packages: [old.name, next.name], project: opened };

      return diffModules(ctx, await modulesOf(opened, imports, keys));
    }),
  );
}

/** The side an installed package makes: the name it is imported by and the subpaths its `exports` reach. */
export function sideOf(pkg: Package): Side {
  const files = fs.readdirSync(pkg.root, { recursive: true }).map(String);

  return { name: pkg.name, subpaths: exportSubpaths(pkg.installed.exports, files).subpaths };
}
