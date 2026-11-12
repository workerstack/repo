import fs from "node:fs";
import path from "node:path";

import ts from "typescript";

import {
  DEFINE_ENV,
  DEFINE_ENV_CALL,
  CREDENTIAL_NAME,
  CREDENTIAL_REASON,
  CREDENTIAL_SHAPE,
  DIGIT,
  ENTROPY_BITS,
  ENTROPY_REASON,
  LETTER,
  LOWER,
  PROCESS_BLOCK,
  PUBLIC_PREFIXES,
  SCANNED_EXTENSIONS,
  SCOPE_BLOCKS,
  SEAL_HINT,
  SECRET_PREFIXES,
  TOKEN_SHAPE,
  UPPER,
  URL_MARK,
  VALUE_BLOCKS,
} from "./check-env-values.constants.ts";
import { ENV_PROPERTY } from "./env.constants.ts";
import { FIXTURES_DIR } from "./fixtures.constants.ts";
import { listFiles } from "./list-files.ts";
import { isTestFile } from "./test-files.ts";

/** Modules whose `env` export is the process environment, as env-in-config reads them. */
const ENV_MODULES: readonly string[] = ["process", "node:process", "cloudflare:workers"];
/** Globals that carry the environment as `.env`. */
const ENV_GLOBALS: readonly string[] = ["process", "Bun"];

/** The object literal blocks of a defineEnv call, by block name. */
type Blocks = ReadonlyMap<string | undefined, ts.ObjectLiteralExpression>;

/** A block of a defineEnv call: its literal keys in order, and whether a spread hides more. */
type Block = { readonly keys: readonly string[]; readonly hasSpread: boolean };

/** The Shannon entropy of `text`, in bits per character. */
function entropyOf(text: string): number {
  const counts = new Map<string, number>();
  for (const char of text) counts.set(char, (counts.get(char) ?? 0) + 1);
  const shares = [...counts.values()].map((count) => count / text.length);
  return shares.reduce((bits, share) => bits - share * Math.log2(share), 0);
}

/** A mixed-case token of high entropy: no hex id, UUID, domain or slug mixes both cases. */
function isRandomToken(value: string): boolean {
  return TOKEN_SHAPE.test(value) && UPPER.test(value) && LOWER.test(value) && entropyOf(value) >= ENTROPY_BITS;
}

/** A long value of letters and digits, no space, under a key named for a credential. */
function isNamedCredential(key: string, value: string): boolean {
  return CREDENTIAL_NAME.test(key) && CREDENTIAL_SHAPE.test(value) && LETTER.test(value);
}

/**
 * Why the value of `key` looks like a secret (`sk_ prefix`, `high entropy`, `credential name`), or null when it does
 * not: a provider prefix; a mixed-case token with digits of high entropy; or a long letter-and-digit value under a key
 * named for a credential. A URL and a Stripe publishable key are never secrets.
 */
function secretReason(key: string, value: string): string | null {
  if (PUBLIC_PREFIXES.some((head) => value.startsWith(head))) return null;
  const prefix = SECRET_PREFIXES.find((head) => value.startsWith(head));
  if (prefix !== undefined) return `${prefix} prefix`;
  if (value.includes(URL_MARK) || !DIGIT.test(value)) return null;
  if (isRandomToken(value)) return ENTROPY_REASON;
  return isNamedCredential(key, value) ? CREDENTIAL_REASON : null;
}

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

/** The object literal blocks of a defineEnv call, by block name; a block held in a variable is not read. */
function blocksOf(call: ts.CallExpression): Map<string | undefined, ts.ObjectLiteralExpression> {
  const members = call.arguments
    .slice(0, 1)
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
    const blocks = blocksOf(call);
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
