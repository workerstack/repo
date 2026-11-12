import fs from "node:fs";
import path from "node:path";

import ts from "typescript";

import {
  DEFINE_ENV,
  DEFINE_ENV_CALL,
  PROCESS_BLOCK,
  SCANNED_EXTENSIONS,
  SCOPE_BLOCKS,
  SEAL_HINT,
  VALUE_BLOCKS,
} from "./check-env-values.constants.ts";
import { ENV_PROPERTY } from "./env.constants.ts";
import { FIXTURES_DIR } from "./fixtures.constants.ts";
import { listFiles } from "./list-files.ts";
import { secretReason } from "./secret-reason.ts";
import { isTestFile } from "./test-files.ts";

/** Modules whose `env` export is the process environment, as env-in-config reads them. */
const ENV_MODULES: readonly string[] = ["process", "node:process", "cloudflare:workers"];

/** Globals that carry the environment as `.env`. */
const ENV_GLOBALS: readonly string[] = ["process", "Bun"];

/** The object literal blocks of a defineEnv call, by block name. */
type Blocks = ReadonlyMap<string | undefined, ts.ObjectLiteralExpression>;

/** A block of a defineEnv call: its literal keys in order, and whether a spread hides more. */
type Block = { readonly keys: readonly string[]; readonly hasSpread: boolean };

/** The plain name of a key or binding, or undefined for a computed key or a pattern. */
function keyName(name: ts.Node): string | undefined {
  return ts.isIdentifier(name) || ts.isStringLiteral(name) ? name.text : undefined;
}

/** The string a literal value holds, or undefined for any other expression. */
function literalText(node: ts.Expression): string | undefined {
  return ts.isStringLiteralLike(node) ? node.text : undefined;
}

/** True for a call of the function named `name`. */
function isCallOf(node: ts.Node, name: string): node is ts.CallExpression {
  return ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === name;
}

/** `node` with every `as`, `satisfies` and pair of parentheses around it taken off. */
function unwrapped(node: ts.Expression): ts.Expression {
  const isWrapper = ts.isAsExpression(node) || ts.isSatisfiesExpression(node) || ts.isParenthesizedExpression(node);

  return isWrapper ? unwrapped(node.expression) : node;
}

/** The initializer of the top-level `const <name>` of the file, or `name` itself when no such const holds one. */
function constValue(file: ts.SourceFile, name: ts.Identifier): ts.Expression {
  const declarations = file.statements
    .filter(ts.isVariableStatement)
    .filter((statement) => (statement.declarationList.flags & ts.NodeFlags.Const) !== 0)
    .flatMap((statement) => statement.declarationList.declarations);

  return declarations.find((declaration) => keyName(declaration.name) === name.text)?.initializer ?? name;
}

/** The config a defineEnv call is given, inline or by the name of a same-file const, unwrapped. */
function configOf(file: ts.SourceFile, argument: ts.Expression): ts.Expression {
  return unwrapped(ts.isIdentifier(argument) ? constValue(file, argument) : argument);
}

/** The object literal blocks of a defineEnv call, by block name; a block held in a variable is not read. */
function blocksOf(file: ts.SourceFile, call: ts.CallExpression): Map<string | undefined, ts.ObjectLiteralExpression> {
  const members = call.arguments
    .slice(0, 1)
    .map((argument) => configOf(file, argument))
    .filter(ts.isObjectLiteralExpression)
    .flatMap((config) => config.properties.filter(ts.isPropertyAssignment));

  const blocks = new Map<string | undefined, ts.ObjectLiteralExpression>();

  for (const member of members)
    if (ts.isObjectLiteralExpression(member.initializer)) blocks.set(keyName(member.name), member.initializer);

  return blocks;
}

/** The literal keys of a block, and whether it spreads another object. */
function blockOf(node: ts.ObjectLiteralExpression): Block {
  const keys: string[] = [];
  let hasSpread = false;

  for (const member of node.properties) {
    const name = member.name === undefined ? undefined : keyName(member.name);

    if (name === undefined) hasSpread = true;
    else keys.push(name);
  }

  return { hasSpread, keys };
}

/** One line per plain value of a value block that looks like a secret. */
function secretLines(rel: string, blocks: Blocks): string[] {
  const lines: string[] = [];

  for (const scope of VALUE_BLOCKS) {
    for (const member of blocks.get(scope)?.properties ?? []) {
      if (!ts.isPropertyAssignment(member)) continue;
      const key = member.name.getText();
      const value = literalText(member.initializer);
      const reason = value === undefined ? null : secretReason(key, value);

      if (reason === null) continue;
      lines.push(`env: ${rel} ${scope}.${key} looks like a secret (${reason}) but is plain; ${SEAL_HINT}`);
    }
  }

  return lines;
}

/** One line per key a scope block lacks that another holds; blocks with a spread or no key take no part. */
function missingLines(rel: string, blocks: Blocks): string[] {
  const scopes = SCOPE_BLOCKS.flatMap((scope) => {
    const node = blocks.get(scope);
    const block = node === undefined ? undefined : blockOf(node);

    return block === undefined || block.hasSpread || block.keys.length === 0 ? [] : [{ keys: block.keys, scope }];
  });

  const lines: string[] = [];

  for (const { scope, keys } of scopes) {
    for (const other of scopes) {
      const fix = `add it to ${scope} or remove it from ${other.scope}`;

      for (const key of other.keys.filter((name) => !keys.includes(name)))
        lines.push(`env: ${rel} ${scope}.${key} is missing (${other.scope} has it); ${fix}`);
    }
  }

  return lines;
}

/** The local names one import binds to the `env` of a process module. */
function envImportNames(statement: ts.ImportDeclaration): string[] {
  const from = statement.moduleSpecifier;

  if (!ts.isStringLiteral(from) || !ENV_MODULES.includes(from.text)) return [];
  const bindings = statement.importClause?.namedBindings;

  if (bindings === undefined || !ts.isNamedImports(bindings)) return [];

  return bindings.elements
    .filter((element) => (element.propertyName ?? element.name).text === ENV_PROPERTY)
    .map((element) => element.name.text);
}

/** The local names an `import { env } from "process"` binds. */
function envImports(file: ts.SourceFile): Set<string> {
  return new Set(file.statements.filter(ts.isImportDeclaration).flatMap(envImportNames));
}

/** How a read names the environment it reads (`process.env`, `env`), or undefined when it is not one. */
function envOwner(node: ts.Expression, imported: ReadonlySet<string>): string | undefined {
  if (ts.isIdentifier(node)) return imported.has(node.text) ? node.text : undefined;

  if (!ts.isPropertyAccessExpression(node) || node.name.text !== ENV_PROPERTY) return undefined;
  const owner = node.expression;

  if (ts.isIdentifier(owner) && ENV_GLOBALS.includes(owner.text)) return `${owner.text}.${ENV_PROPERTY}`;

  return ts.isMetaProperty(owner) ? `import.meta.${ENV_PROPERTY}` : undefined;
}

/** A named read of the environment: the variable and the text a line shows for it. */
type Read = { readonly key: string; readonly label: string };

/** The named reads `node` makes: `owner.KEY`, `owner["KEY"]` or `const { KEY } = owner`. */
function readsAt(node: ts.Node, imported: ReadonlySet<string>): Read[] {
  if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
    const owner = envOwner(node.expression, imported);
    const key = ts.isPropertyAccessExpression(node) ? node.name.text : literalText(node.argumentExpression);

    return owner === undefined || key === undefined ? [] : [{ key, label: `${owner}.${key}` }];
  }

  const isDestructure = ts.isVariableDeclaration(node) && ts.isObjectBindingPattern(node.name);

  if (!isDestructure || node.initializer === undefined) return [];
  const owner = envOwner(node.initializer, imported);

  if (owner === undefined) return [];

  return node.name.elements.flatMap((element) => {
    const key = element.dotDotDotToken === undefined ? keyName(element.propertyName ?? element.name) : undefined;

    return key === undefined ? [] : [{ key, label: `${owner}.${key}` }];
  });
}

/** Calls `visit` on `node` and every node under it, parents first. */
function forEachNode(node: ts.Node, visit: (node: ts.Node) => void): void {
  visit(node);
  ts.forEachChild(node, (child) => forEachNode(child, visit));
}

/** One line per variable the file reads by name that no process block declares, once each. */
function processLines(rel: string, file: ts.SourceFile, declared: ReadonlySet<string>): string[] {
  const imported = envImports(file);
  const seen = new Set<string>();
  const lines: string[] = [];
  forEachNode(file, (node) => {
    for (const { key, label } of readsAt(node, imported)) {
      if (declared.has(key) || seen.has(key)) continue;
      seen.add(key);
      lines.push(`env: ${rel} reads ${label} but its process block does not declare it; add \`${key}: "optional"\``);
    }
  });

  return lines;
}

/** Every defineEnv call of the file, outermost first. */
function defineCalls(file: ts.SourceFile): ts.CallExpression[] {
  const calls: ts.CallExpression[] = [];
  forEachNode(file, (node) => {
    if (isCallOf(node, DEFINE_ENV)) calls.push(node);
  });

  return calls;
}

/** The lines of one defineEnv file: plaintext secrets, keys a scope lacks, then undeclared process reads. */
function fileLines(rel: string, text: string): string[] {
  const file = ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true);
  const declared = new Set<string>();
  const lines: string[] = [];

  for (const call of defineCalls(file)) {
    const blocks = blocksOf(file, call);
    lines.push(...secretLines(rel, blocks), ...missingLines(rel, blocks));
    const processBlock = blocks.get(PROCESS_BLOCK);

    for (const key of processBlock === undefined ? [] : blockOf(processBlock).keys) declared.add(key);
  }

  return [...lines, ...processLines(rel, file, declared)];
}

/** True for a file the check reads: a source of a scanned extension, not a test and not under `__fixtures__`. */
function isScanned(rel: string): boolean {
  return (
    SCANNED_EXTENSIONS.includes(path.posix.extname(rel)) && !isTestFile(rel) && !rel.split("/").includes(FIXTURES_DIR)
  );
}

/**
 * One line per problem in each listed file that calls `defineEnv(`: a plain value that looks like a secret, a key one
 * scope block holds and another lacks, and a process read its process block does not declare.
 */
export function checkEnvValues(cwd: string): string[] {
  return listFiles(cwd)
    .filter(isScanned)
    .flatMap((rel) => {
      const file = path.join(cwd, rel);

      // A tracked file deleted and not yet staged is still listed.
      if (!fs.existsSync(file)) return [];
      const text = fs.readFileSync(file, "utf8");

      return text.includes(DEFINE_ENV_CALL) ? fileLines(rel, text) : [];
    });
}
