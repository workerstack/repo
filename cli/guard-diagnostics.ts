/**
 * Type guards proven with an input they must reject: an exported function whose return type is a type predicate needs
 * a test that asserts it returns false, else a lint diagnostic `repo(guard-rejects)` the baseline counts. A guard
 * tested only on what it accepts still passes a guard that accepts everything. The tests are read with the type
 * checker of TypeScript 7, so an import renamed or through a namespace still reaches the guard.
 */
import fs from "node:fs";
import path from "node:path";

import { ModifierFlags, SyntaxKind } from "typescript/unstable/ast";
import type {
  ArrowFunction,
  CallExpression,
  FunctionDeclaration,
  FunctionExpression,
  Identifier,
  Node,
  PropertyAccessExpression,
  SourceFile,
  Statement,
} from "typescript/unstable/ast";
import {
  isArrowFunction,
  isCallExpression,
  isFunctionDeclaration,
  isFunctionExpression,
  isIdentifier,
  isImportDeclaration,
  isPropertyAccessExpression,
  isSourceFile,
  isVariableStatement,
} from "typescript/unstable/ast/is";
import { SymbolFlags, TypePredicateKind, type Project, type Symbol as TsSymbol } from "typescript/unstable/async";

import { EXPECT } from "./expect.constants.ts";
import type { Result } from "./result.ts";
import { codeOf, GUARD_REJECTS } from "./script-rules.ts";
import type { Diagnostic } from "./scripts/lint-baseline.ts";
import { type OwnerConfig, ownerConfig, sourcesOf, type TsRun, withFiles } from "./ts-api.ts";
import { modifierFlagsOf } from "./ts-nodes.ts";
import { byOwner, isChecked, isTest, ownerOf, posix } from "./ts-program.ts";

/** An exported guard: its declared name node and the symbol a call resolves to. */
type Guard = { name: Identifier; symbol: TsSymbol };

/** One tsconfig's files, as posix paths: the root, its dir, the sources to report in and the changed tests. */
type Group = { root: string; dir: string | null; sources: string[]; tests: string[] };

type FunctionLike = FunctionDeclaration | ArrowFunction | FunctionExpression;

/** An exported function and the name it is declared with. */
type Named = { name: Identifier; fn: FunctionLike };

const RULE = /* @__PURE__ */ codeOf(GUARD_REJECTS);

/** The asserts that a call returned false; a test file without one cannot prove a guard rejects. */
const FALSE_ASSERT = /\.(?:toBe|toEqual)\(\s*false\s*\)|\.toBeFalsy\(\s*\)/;

/** Each matcher that can assert false, by the argument count that does: `toBe(false)` and `toBeFalsy()`. */
const FALSE_MATCHERS: ReadonlyMap<string, number> = /* @__PURE__ */ new Map([
  ["toBe", 1],
  ["toEqual", 1],
  ["toBeFalsy", 0],
]);

function message(name: string): string {
  return `${name} is never asserted false; add expect(${name}(<an input it must reject>)).toBe(false) to a test`;
}

function isExported(node: Parameters<typeof modifierFlagsOf>[0]): boolean {
  return (modifierFlagsOf(node) & ModifierFlags.Export) !== 0;
}

/** Whether `fn` returns `x is T` or `this is T`, written or inferred; an `asserts` function is no guard. */
async function isGuard(fn: FunctionLike, project: Project): Promise<boolean> {
  const signatures = [await project.checker.getSignatureFromDeclaration(fn)].filter(
    (signature) => signature !== undefined,
  );

  const predicates = await Promise.all(
    signatures.map((signature) => project.checker.getTypePredicateOfSignature(signature)),
  );

  return predicates.some(
    (predicate) => predicate?.kind === TypePredicateKind.Identifier || predicate?.kind === TypePredicateKind.This,
  );
}

/** The exported function declarations and `const` function values of a statement, with their names. */
function functionsOf(statement: Statement): Named[] {
  if (isFunctionDeclaration(statement) && statement.name !== undefined && isExported(statement))
    return [{ fn: statement, name: statement.name }];

  if (!isVariableStatement(statement)) return [];

  return statement.declarationList.declarations.flatMap((declaration) => {
    const init = declaration.initializer;
    const isFunction = init !== undefined && (isArrowFunction(init) || isFunctionExpression(init));

    if (!isFunction || !isIdentifier(declaration.name) || !isExported(declaration)) return [];

    return [{ fn: init, name: declaration.name }];
  });
}

/** The exported guards `file` declares. */
async function guardsOf(file: SourceFile, project: Project): Promise<Guard[]> {
  const named = file.statements.flatMap(functionsOf);

  if (named.length === 0) return [];
  const symbols = await project.checker.getSymbolAtLocation(named.map(({ name }) => name));
  const guards: Guard[] = [];

  for (const [index, { fn, name }] of named.entries()) {
    const symbol = symbols[index];

    if (symbol !== undefined && (await isGuard(fn, project))) guards.push({ name, symbol });
  }

  return guards;
}

/** The symbol an imported name finally declares, through renames, namespaces and re-exports. */
async function resolved(symbol: TsSymbol, project: Project): Promise<TsSymbol> {
  return (symbol.flags & SymbolFlags.Alias) === 0 ? symbol : await project.checker.getAliasedSymbol(symbol);
}

/** Whether `call` is a matcher asserting false: `.toBe(false)`, `.toEqual(false)` or `.toBeFalsy()`. */
function assertsFalse(call: CallExpression): call is CallExpression & { expression: PropertyAccessExpression } {
  if (!isPropertyAccessExpression(call.expression)) return false;
  const count = FALSE_MATCHERS.get(call.expression.name.text);

  if (count !== call.arguments.length) return false;
  const [arg] = call.arguments;

  return arg === undefined || arg.kind === SyntaxKind.FalseKeyword;
}

/** The function `call` asserts false the result of, as in `expect(isUser(input)).toBe(false)`. */
function falseCallee(call: CallExpression): Node | undefined {
  if (!assertsFalse(call)) return undefined;
  const expected = call.expression.expression;

  if (!isCallExpression(expected) || !isIdentifier(expected.expression)) return undefined;

  if (expected.expression.text !== EXPECT) return undefined;
  const [subject] = expected.arguments;

  if (subject === undefined || !isCallExpression(subject)) return undefined;
  const callee = subject.expression;

  return isPropertyAccessExpression(callee) ? callee.name : callee;
}

/** Every symbol a test file asserts a call of returns false. */
async function assertedFalse(file: SourceFile, project: Project): Promise<TsSymbol[]> {
  const callees: Node[] = [];

  function visit(node: Node): void {
    const callee = isCallExpression(node) ? falseCallee(node) : undefined;

    if (callee !== undefined) callees.push(callee);
    node.forEachChild(visit);
  }

  visit(file);

  if (callees.length === 0) return [];
  const found: TsSymbol[] = [];

  for (const symbol of await project.checker.getSymbolAtLocation(callees))
    if (symbol !== undefined) found.push(await resolved(symbol, project));

  return found;
}

/** The posix paths of the source files `file` imports. */
async function importsOf(file: SourceFile, project: Project): Promise<string[]> {
  const specifiers = file.statements.flatMap((statement) =>
    isImportDeclaration(statement) ? [statement.moduleSpecifier] : [],
  );

  if (specifiers.length === 0) return [];
  const paths: string[] = [];

  for (const symbol of await project.checker.getSymbolAtLocation(specifiers)) {
    const handle = symbol?.valueDeclaration;
    // A handle's path is the checker's canonical one, lower case on a case-blind disk; the node keeps the spelling.
    const declaration = handle?.kind === SyntaxKind.SourceFile ? await handle.resolve(project) : undefined;

    if (declaration !== undefined && isSourceFile(declaration)) paths.push(declaration.fileName);
  }

  return paths;
}

/** The tsconfig's tests that assert some call false, read as text first so a project parses only those. */
function falseTests(group: Group, config: OwnerConfig): string[] {
  const owned = config.fileNames.filter((fileName) => {
    const rel = path.posix.relative(group.root, fileName);

    return isTest(rel) && ownerOf(group.root, rel) === group.dir;
  });

  return owned.filter((fileName) => FALSE_ASSERT.test(fs.readFileSync(fileName, "utf8")));
}

/** The sources to report in: the group's, and those its changed tests import from the same tsconfig. */
async function targetsOf(group: Group, project: Project): Promise<string[]> {
  const imported: string[] = [];

  for (const file of await sourcesOf(project, group.tests)) imported.push(...(await importsOf(file, project)));

  const owned = imported.filter((fileName) => {
    const rel = path.posix.relative(group.root, fileName);

    return isChecked(rel) && ownerOf(group.root, rel) === group.dir;
  });

  return [...new Set([...group.sources, ...owned])];
}

/** The guards declared in `targets`. */
async function guardsIn(project: Project, targets: readonly string[]): Promise<Guard[]> {
  const guards: Guard[] = [];

  for (const file of await sourcesOf(project, targets)) guards.push(...(await guardsOf(file, project)));

  return guards;
}

/** The guards of `targets` no test among `tests` asserts false, from a project over both. */
async function untestedIn(project: Project, targets: readonly string[], tests: readonly string[]): Promise<Guard[]> {
  const asserted = new Set<TsSymbol>();

  for (const file of await sourcesOf(project, tests))
    for (const symbol of await assertedFalse(file, project)) asserted.add(symbol);

  const guards = await guardsIn(project, targets);

  return guards.filter((guard) => !asserted.has(guard.symbol));
}

/**
 * One group's untested guards. A first project finds the targets and whether they declare a guard; only then a second
 * adds the tests that could assert one false, reusing what the first parsed.
 */
async function groupGuards(run: TsRun, group: Group): Promise<Result<Guard[]>> {
  const config = await ownerConfig(run, group.root, group.dir);

  if (!config.ok) return config;
  const { base, dir } = config.value;

  const guards = await withFiles(run, { base, dir, files: [...group.sources, ...group.tests] }, async (project) => {
    const targets = await targetsOf(group, project);

    const declared = await guardsIn(project, targets);

    if (declared.length === 0) return [];
    const tests = [...new Set([...falseTests(group, config.value), ...group.tests])];

    return withFiles(run, { base, dir, files: [...targets, ...tests] }, (wider) => untestedIn(wider, targets, tests));
  });

  return { ok: true, value: guards };
}

function diagnosticOf(root: string, { name }: Guard): Diagnostic {
  const file = name.getSourceFile();
  const rel = path.posix.relative(root, file.fileName);
  const { line, character } = file.getLineAndCharacterOfPosition(name.getStart(file));

  return { file: rel, line: `${rel}:${line + 1}:${character + 1}: error ${RULE}: ${message(name.text)}`, rule: RULE };
}

/**
 * The untested exported guards of the checked sources among `files` (root-relative POSIX paths), and of the sources
 * the tests among them import, in oxlint's line form; or why a tsconfig.json could not be read. A guard passes when a
 * test of its tsconfig asserts a call of it false. Each owner's projects open on `run`, one at a time.
 */
export async function guardDiagnostics(
  run: TsRun,
  root: string,
  files: readonly string[],
): Promise<Result<Diagnostic[]>> {
  const real = posix(fs.realpathSync(root));
  const diagnostics: Diagnostic[] = [];

  for (const [dir, owned] of byOwner(
    real,
    files.filter((file) => isChecked(file) || isTest(file)),
  )) {
    const group: Group = { dir, root: real, sources: [], tests: [] };

    for (const fileName of owned)
      (isTest(path.posix.relative(real, fileName)) ? group.tests : group.sources).push(fileName);
    const found = await groupGuards(run, group);

    if (!found.ok) return found;
    diagnostics.push(...found.value.map((guard) => diagnosticOf(real, guard)));
  }

  return { ok: true, value: diagnostics };
}
