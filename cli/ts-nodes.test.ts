import fs from "node:fs";

import { ModifierFlags, type SourceFile, type VariableDeclaration } from "typescript/unstable/ast";
import {
  isClassDeclaration,
  isForOfStatement,
  isFunctionDeclaration,
  isImportDeclaration,
  isNamedImports,
  isPropertyDeclaration,
  isStringLiteral,
  isVariableDeclarationList,
  isVariableStatement,
} from "typescript/unstable/ast/is";
import { expect, it } from "vitest";

import { put, tempDir, useTempDirs } from "./sync/__fixtures__/temp-dirs.ts";
import { withFiles, withTsApi } from "./ts-api.ts";
import { ancestorOf, modifierFlagsOf } from "./ts-nodes.ts";
import { posix } from "./ts-program.ts";

useTempDirs();

const SOURCE = [
  'import { a } from "./b.ts";',
  "export const NAME = 'quick';",
  "let loose = a;",
  "for (const item of [loose]) void item;",
  "export function f() {}",
  "export class K {",
  "  static readonly MAX = 9;",
  "}",
  "",
].join("\n");

/** What `read` gives of `a.ts`, holding SOURCE, parsed on TypeScript 7. */
function onSource<T>(read: (file: SourceFile) => T): Promise<T> {
  const dir = posix(fs.realpathSync(tempDir("ts-nodes-")));
  put(dir, "a.ts", SOURCE);
  put(dir, "b.ts", "export const a = 1;\n");

  return withTsApi(dir, (run) =>
    withFiles(run, { base: null, dir, files: [`${dir}/a.ts`] }, async (project) => {
      const file = await project.program.getSourceFile(`${dir}/a.ts`);

      if (file === undefined) throw new Error("a.ts was not parsed");

      return read(file);
    }),
  );
}

/** The first declaration of the variable statement at `index`, or of the `for` loop there. */
function declarationAt(file: SourceFile, index: number): VariableDeclaration {
  const statement = file.statements[index];
  const loop = statement !== undefined && isForOfStatement(statement) ? statement.initializer : undefined;
  const list = statement !== undefined && isVariableStatement(statement) ? statement.declarationList : loop;
  const [declaration] = list !== undefined && isVariableDeclarationList(list) ? list.declarations : [];

  if (declaration === undefined) throw new Error(`statement ${index} declares no variable`);

  return declaration;
}

it("gives a variable declaration its statement's modifiers", async () => {
  const flags = await onSource((file) => [declarationAt(file, 1), declarationAt(file, 2)].map(modifierFlagsOf));

  expect(flags.map((flag) => (flag & ModifierFlags.Export) !== 0)).toStrictEqual([true, false]);
});

it("gives a loop's variable declaration no modifiers", async () => {
  expect(await onSource((file) => modifierFlagsOf(declarationAt(file, 3)))).toBe(ModifierFlags.None);
});

it("gives a function and a class property their own modifiers", async () => {
  const flags = await onSource((file) => {
    const [, , , , fn, cls] = file.statements;

    if (fn === undefined || !isFunctionDeclaration(fn) || cls === undefined || !isClassDeclaration(cls))
      throw new Error("the function or class moved");
    const [property] = cls.members;

    if (property === undefined || !isPropertyDeclaration(property)) throw new Error("the property moved");

    return [modifierFlagsOf(fn), modifierFlagsOf(property)];
  });

  expect(flags).toStrictEqual([ModifierFlags.Export, ModifierFlags.Static | ModifierFlags.Readonly]);
});

it("finds the import a specifier sits in, and itself when it matches", async () => {
  const kinds = await onSource((file) => {
    const [statement] = file.statements;

    if (statement === undefined || !isImportDeclaration(statement)) throw new Error("the import moved");
    const bindings = statement.importClause?.namedBindings;
    const [specifier] = bindings !== undefined && isNamedImports(bindings) ? bindings.elements : [];

    if (specifier === undefined) throw new Error("the specifier moved");

    return [ancestorOf(specifier, isImportDeclaration), ancestorOf(statement, isImportDeclaration)];
  });

  expect(kinds.map((node) => node?.getText())).toStrictEqual([
    'import { a } from "./b.ts";',
    'import { a } from "./b.ts";',
  ]);
});

it("finds no ancestor that is not there", async () => {
  expect(await onSource((file) => ancestorOf(declarationAt(file, 1), isStringLiteral))).toBeUndefined();
});
