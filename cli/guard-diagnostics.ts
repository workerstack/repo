/**
 * Type guards proven with an input they must reject: an exported function whose return type is a type predicate needs
 * a test that asserts it returns false, else a lint diagnostic `repo(guard-rejects)` the baseline counts. A guard
 * tested only on what it accepts still passes a guard that accepts everything. The tests are read with the type
 * checker, so an import renamed or through a namespace still reaches the guard.
 */
import fs from "node:fs";
import path from "node:path";

import ts from "typescript";

import { codeOf, GUARD_REJECTS } from "./lint/script-rules.ts";
import type { Diagnostic, Result } from "./scripts/lint-baseline.ts";
import { isChecked, isTest, ownerOf, posix, setupOf } from "./ts-program.ts";
import { RUNTIME_CONFIG } from "./tsconfig.constants.ts";

/** An exported guard: its declared name node and the symbol a call resolves to. */
type Guard = { name: ts.Identifier; symbol: ts.Symbol };
/** One tsconfig's files, as program paths: the sources to report in and the changed tests whose imports join them. */
type Group = { root: string; dir: string | null; sources: string[]; tests: string[] };
type FunctionLike = ts.FunctionDeclaration | ts.ArrowFunction | ts.FunctionExpression;

const RULE = /* @__PURE__ */ codeOf(GUARD_REJECTS);
/** The asserts that a call returned false; a test file without one cannot prove a guard rejects. */
const FALSE_ASSERT = /\.(?:toBe|toEqual)\(\s*false\s*\)|\.toBeFalsy\(\s*\)/;
/** Each matcher that can assert false, by the argument count that does: `toBe(false)` and `toBeFalsy()`. */
const FALSE_MATCHERS: ReadonlyMap<string, number> = /* @__PURE__ */ new Map([
  ["toBe", 1],
  ["toEqual", 1],
  ["toBeFalsy", 0],
]);
/** vitest's `expect`, as the checker spells an identifier. */
const EXPECT: ts.__String = /* @__PURE__ */ ts.escapeLeadingUnderscores("expect");

const message = (name: string): string =>
  `${name} is never asserted false; add expect(${name}(<an input it must reject>)).toBe(false) to a test`;

const isExported = (node: ts.Declaration): boolean =>
  (ts.getCombinedModifierFlags(node) & ts.ModifierFlags.Export) !== 0;

/** Whether `fn` returns `x is T` or `this is T`, written or inferred; an `asserts` function is no guard. */
function isGuard(fn: FunctionLike, checker: ts.TypeChecker): boolean {
  const signature = checker.getSignatureFromDeclaration(fn);
  const predicate = signature && checker.getTypePredicateOfSignature(signature);
  const kind = predicate?.kind;
  return kind === ts.TypePredicateKind.Identifier || kind === ts.TypePredicateKind.This;
}

/** The exported function declarations and `const` function values of a statement, with their names. */
function functionsOf(statement: ts.Statement): { name: ts.Identifier; fn: FunctionLike }[] {
  if (ts.isFunctionDeclaration(statement) && statement.name && isExported(statement))
    return [{ fn: statement, name: statement.name }];
  if (!ts.isVariableStatement(statement)) return [];
  return statement.declarationList.declarations.flatMap((declaration) => {
    const init = declaration.initializer;
    const isFunction = init !== undefined && (ts.isArrowFunction(init) || ts.isFunctionExpression(init));
    if (!isFunction || !ts.isIdentifier(declaration.name) || !isExported(declaration)) return [];
    return [{ fn: init, name: declaration.name }];
  });
}

function guardsOf(file: ts.SourceFile, checker: ts.TypeChecker): Guard[] {
  return file.statements.flatMap((statement) =>
    functionsOf(statement).flatMap(({ name, fn }) => {
      const symbol = checker.getSymbolAtLocation(name);
      return symbol !== undefined && isGuard(fn, checker) ? [{ name, symbol }] : [];
    }),
  );
}

/** The symbol an imported name finally declares, through renames, namespaces and re-exports. */
function resolved(symbol: ts.Symbol, checker: ts.TypeChecker): ts.Symbol {
  return (symbol.flags & ts.SymbolFlags.Alias) === 0 ? symbol : checker.getAliasedSymbol(symbol);
}

/** Whether `call` is a matcher asserting false: `.toBe(false)`, `.toEqual(false)` or `.toBeFalsy()`. */
function assertsFalse(
  call: ts.CallExpression,
): call is ts.CallExpression & { expression: ts.PropertyAccessExpression } {
  if (!ts.isPropertyAccessExpression(call.expression)) return false;
  const count = FALSE_MATCHERS.get(call.expression.name.text);
  if (count !== call.arguments.length) return false;
  const [arg] = call.arguments;
  return arg === undefined || arg.kind === ts.SyntaxKind.FalseKeyword;
}

/** The function `call` asserts false the result of, as in `expect(isUser(input)).toBe(false)`. */
function falseCallee(call: ts.CallExpression): ts.Node | undefined {
  if (!assertsFalse(call)) return undefined;
  const expected = call.expression.expression;
  if (!ts.isCallExpression(expected) || !ts.isIdentifier(expected.expression)) return undefined;
  if (expected.expression.escapedText !== EXPECT) return undefined;
  const [subject] = expected.arguments;
  if (subject === undefined || !ts.isCallExpression(subject)) return undefined;
  const callee = subject.expression;
  return ts.isPropertyAccessExpression(callee) ? callee.name : callee;
}

/** Every symbol a test file asserts a call of returns false. */
function assertedFalse(file: ts.SourceFile, checker: ts.TypeChecker): ts.Symbol[] {
  const found: ts.Symbol[] = [];
  const visit = (node: ts.Node): void => {
    const callee = ts.isCallExpression(node) ? falseCallee(node) : undefined;
    const symbol = callee && checker.getSymbolAtLocation(callee);
    if (symbol) found.push(resolved(symbol, checker));
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

/** The program paths of the modules `file` imports. */
function importsOf(file: ts.SourceFile, checker: ts.TypeChecker): string[] {
  return file.statements.flatMap((statement) => {
    if (!ts.isImportDeclaration(statement)) return [];
    const declaration = checker.getSymbolAtLocation(statement.moduleSpecifier)?.valueDeclaration;
    return declaration !== undefined && ts.isSourceFile(declaration) ? [declaration.fileName] : [];
  });
}

/** The tsconfig's tests that assert some call false, read as text first so a program parses only those. */
function falseTests(group: Group, fileNames: readonly string[]): string[] {
  const owned = fileNames.filter((fileName) => {
    const rel = path.posix.relative(group.root, fileName);
    return isTest(rel) && ownerOf(group.root, rel) === group.dir;
  });
  return owned.filter((fileName) => FALSE_ASSERT.test(fs.readFileSync(fileName, "utf8")));
}

/** The sources to report in: the group's, and those its changed tests import from the same tsconfig. */
function targetsOf(group: Group, program: ts.Program): string[] {
  const checker = program.getTypeChecker();
  const tests = program.getSourceFiles().filter((file) => group.tests.includes(file.fileName));
  const imported = tests.flatMap((file) => importsOf(file, checker));
  const owned = imported.filter((fileName) => {
    const rel = path.posix.relative(group.root, fileName);
    return isChecked(rel) && ownerOf(group.root, rel) === group.dir;
  });
  return [...new Set([...group.sources, ...owned])];
}

/** The guards declared in `targets`. */
function guardsIn(program: ts.Program, targets: readonly string[]): Guard[] {
  const checker = program.getTypeChecker();
  const files = program.getSourceFiles().filter((file) => targets.includes(file.fileName));
  return files.flatMap((file) => guardsOf(file, checker));
}

/**
 * One group's untested guards. A first program finds the targets and whether they declare a guard; only then a second
 * adds the tests that could assert one false, reusing what the first parsed.
 */
function groupGuards(group: Group): Result<Guard[]> {
  const setup = setupOf(group.root, group.dir, RUNTIME_CONFIG);
  if (!setup.ok) return setup;
  const { options } = setup.value;
  const first = ts.createProgram({ options, rootNames: [...group.sources, ...group.tests] });
  const targets = targetsOf(group, first);
  if (guardsIn(first, targets).length === 0) return { ok: true, value: [] };
  const tests = [...new Set([...falseTests(group, setup.value.fileNames), ...group.tests])];
  const program = ts.createProgram({ oldProgram: first, options, rootNames: [...targets, ...tests] });
  const checker = program.getTypeChecker();
  const testFiles = program.getSourceFiles().filter((file) => tests.includes(file.fileName));
  const asserted = new Set(testFiles.flatMap((file) => assertedFalse(file, checker)));
  return { ok: true, value: guardsIn(program, targets).filter((guard) => !asserted.has(guard.symbol)) };
}

function diagnosticOf(root: string, { name }: Guard): Diagnostic {
  const file = name.getSourceFile();
  const rel = path.posix.relative(root, file.fileName);
  const { line, character } = file.getLineAndCharacterOfPosition(name.getStart());
  return { file: rel, line: `${rel}:${line + 1}:${character + 1}: error ${RULE}: ${message(name.text)}`, rule: RULE };
}

/**
 * The untested exported guards of the checked sources among `files` (root-relative POSIX paths), and of the sources
 * the tests among them import, in oxlint's line form; or why a tsconfig.json could not be read. A guard passes when a
 * test of its tsconfig asserts a call of it false.
 */
export function guardDiagnostics(root: string, files: readonly string[]): Result<Diagnostic[]> {
  const real = posix(fs.realpathSync(root));
  const groups = new Map<string | null, Group>();
  for (const rel of files.filter((file) => isChecked(file) || isTest(file))) {
    const dir = ownerOf(real, rel);
    const group = groups.get(dir) ?? { dir, root: real, sources: [], tests: [] };
    (isTest(rel) ? group.tests : group.sources).push(path.posix.join(real, rel));
    groups.set(dir, group);
  }
  const diagnostics: Diagnostic[] = [];
  for (const group of groups.values()) {
    const found = groupGuards(group);
    if (!found.ok) return found;
    diagnostics.push(...found.value.map((guard) => diagnosticOf(real, guard)));
  }
  return { ok: true, value: diagnostics };
}
