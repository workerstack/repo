/** The defineEnv files of a repo: found among tracked files, read as a TS AST, loaded, and their users. */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import ts from "typescript";

import { DEFINE_ENV, DEFINE_ENV_CALL, SCANNED_EXTENSIONS } from "../check-env-values.constants.ts";
import { FIXTURES_DIR } from "../fixtures.constants.ts";
import { listFiles } from "../list-files.ts";
import { isTestFile } from "../test-files.ts";
import { LAST, LAYERS_SYMBOL, SCOPES, SEALED_NAME, SEALED_SYMBOL } from "./env-command.constants.ts";
import { refuse, relTo } from "./env-io.ts";

/** One value an env file's own blocks declare: its key, block and whether it is sealed. */
export type Declared = { readonly key: string; readonly scope: string; readonly kind: "sealed" | "plain" };

/** A value of a loaded env: plain text, or the cipher of a sealed one. */
export type Value = { readonly cipher?: string; readonly text?: string };

/** A loaded env's merged values by block: plain text, or the cipher of a sealed one. */
export type Layers = ReadonlyMap<string, ReadonlyMap<string, Value>>;

const LAYERS: unique symbol = /* @__PURE__ */ Symbol.for(LAYERS_SYMBOL);
const SEALED: unique symbol = /* @__PURE__ */ Symbol.for(SEALED_SYMBOL);
const PARENT = "parent";

/** A module specifier in an import, an export-from or a dynamic import. */
const TS_EXTENSION = /\.[cm]?tsx?$/u;
const SPECIFIER = /(?:from|import)\s*\(?\s*["']([^"']+)["']/gu;

/** `text` of `rel` as a TS source file. */
export function sourceOf(rel: string, text: string): ts.SourceFile {
  return ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true);
}

/** The plain name of a key or binding; empty for a computed one or a pattern. */
function nameOf(node: ts.Node): string {
  return ts.isIdentifier(node) || ts.isStringLiteral(node) ? node.text : "";
}

/** `node` with every `as`, `satisfies` and pair of parentheses taken off. */
function bare(node: ts.Expression): ts.Expression {
  let inner = node;

  while (ts.isAsExpression(inner) || ts.isSatisfiesExpression(inner) || ts.isParenthesizedExpression(inner))
    inner = inner.expression;

  return inner;
}

/** Every defineEnv call of `source`, in order. */
function defineCalls(source: ts.SourceFile): ts.CallExpression[] {
  const calls: ts.CallExpression[] = [];

  function visit(node: ts.Node): void {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === DEFINE_ENV)
      calls.push(node);
    ts.forEachChild(node, visit);
  }

  visit(source);

  return calls;
}

/** The object literal a call is given, inline or by the name of a top-level const; undefined for anything else. */
function configOf(source: ts.SourceFile, call: ts.CallExpression): ts.ObjectLiteralExpression | undefined {
  const argument = call.arguments.slice(0, 1).map(bare);
  const named = new Set(argument.filter(ts.isIdentifier).map((name) => name.text));

  const held = source.statements
    .filter(ts.isVariableStatement)
    .flatMap((statement) => statement.declarationList.declarations)
    .filter((declaration) => named.has(nameOf(declaration.name)))
    .map((declaration) => declaration.initializer)
    .filter((initializer): initializer is ts.Expression => initializer !== undefined);

  return [...argument, ...held.map(bare)].find(ts.isObjectLiteralExpression);
}

/** The configs of every defineEnv call of `source` that it can read. */
function configsOf(source: ts.SourceFile): ts.ObjectLiteralExpression[] {
  return defineCalls(source).flatMap((call) => configOf(source, call) ?? []);
}

/** The properties of an object literal that assign a plain name, by name. */
export function propertiesOf(node: ts.ObjectLiteralExpression): Map<string, ts.PropertyAssignment> {
  const found = new Map<string, ts.PropertyAssignment>();

  for (const member of node.properties.filter(ts.isPropertyAssignment)) {
    const name = nameOf(member.name);

    if (name !== "") found.set(name, member);
  }

  return found;
}

/** The names the configs of `source` give as `parent`. */
function parentsOf(configs: readonly ts.ObjectLiteralExpression[]): Set<string> {
  const parents = configs
    .map((config) => propertiesOf(config).get(PARENT)?.initializer)
    .filter((node): node is ts.Expression => node !== undefined);

  return new Set(parents.filter(ts.isIdentifier).map((node) => node.text));
}

/** The binding a defineEnv call initializes, `x` of `const x = defineEnv(…)`; empty when it is bound to none. */
function bindingOf(call: ts.CallExpression): string {
  return [call.parent]
    .filter(ts.isVariableDeclaration)
    .map((declaration) => nameOf(declaration.name))
    .join("");
}

/** The config of the env `source` stands for: of several, the last that no other names as its parent. */
export function mainConfig(source: ts.SourceFile): ts.ObjectLiteralExpression | undefined {
  const calls = defineCalls(source);
  const parents = parentsOf(configsOf(source));
  const children = calls.filter((call) => !parents.has(bindingOf(call)));

  return children.map((call) => configOf(source, call)).at(LAST);
}

/** Every value the defineEnv configs of `source` declare in their own global and scope blocks. */
function declaredIn(source: ts.SourceFile): Declared[] {
  return configsOf(source).flatMap((config) => {
    const blocks = propertiesOf(config);

    return SCOPES.flatMap((scope) => {
      const block = blocks.get(scope)?.initializer;

      if (block === undefined || !ts.isObjectLiteralExpression(block)) return [];

      return [...propertiesOf(block)].map(([key, member]): Declared => {
        const value = member.initializer;
        const isSealed = ts.isCallExpression(value) && value.expression.getText(source) === SEALED_NAME;

        return { key, kind: isSealed ? "sealed" : "plain", scope };
      });
    });
  });
}

/** The tracked files of `root`, repo-relative. */
export function trackedFiles(root: string): string[] {
  // A tracked file deleted and not yet staged is still listed.
  return listFiles(root, []).filter((rel) => fs.existsSync(path.join(root, rel)));
}

/** The tracked sources of `root` that call defineEnv, sorted, each with what it declares. */
export function envFiles(root: string, tracked: readonly string[]): Map<string, Declared[]> {
  const found = new Map<string, Declared[]>();

  for (const rel of tracked.toSorted()) {
    const scanned = SCANNED_EXTENSIONS.includes(path.posix.extname(rel)) && !isTestFile(rel);

    if (!scanned || rel.split("/").includes(FIXTURES_DIR)) continue;
    const text = fs.readFileSync(path.join(root, rel), "utf8");

    // The text check is cheap; only a real call in the syntax tree makes an env file,
    // not one named in a string or a comment.
    const source = text.includes(DEFINE_ENV_CALL) ? sourceOf(rel, text) : undefined;

    if (source !== undefined && defineCalls(source).length > 0) found.set(rel, declaredIn(source));
  }

  return found;
}

/** How the choice goes: by `--file`, else the files that declare `key`, else the one env file when `anyOne`. */
export type Choice = { readonly file: string | undefined; readonly key: string | undefined; readonly anyOne: boolean };

/** The env file a verb works on, repo-relative; refuses, naming `--file`, when none or several are left. */
export function chooseFile(root: string, cwd: string, { anyOne, file, key }: Choice): string {
  if (file !== undefined) return relTo(root, path.resolve(cwd, file));
  const all = envFiles(root, trackedFiles(root));
  const declaring = [...all].filter(([, values]) => values.some((value) => value.key === key)).map(([rel]) => rel);
  const pool = declaring.length > 0 || !anyOne ? declaring : [...all.keys()];

  if (pool.length === 1) return String(pool[0]);
  const what = key === undefined ? "in this repo" : `declares ${key}`;

  if (pool.length === 0) refuse(`no defineEnv file ${what}; pass --file <env file>`);

  return refuse(`${pool.length} env files: ${pool.join(", ")}; pass --file`);
}

function isRecord(value: unknown): value is Record<PropertyKey, unknown> {
  return typeof value === "object" && value !== null;
}

/** A defineEnv env as loaded: its merged blocks by name, each value plain text or a sealed brand. */
type LoadedValue = string | { readonly [SEALED]: string };

type LoadedEnv = { readonly [LAYERS]: Readonly<Record<string, Readonly<Record<string, LoadedValue>>>> };

/** A merged block's values: a string as text, a sealed brand as its cipher. */
function blockValues(block: Readonly<Record<string, LoadedValue>> | undefined): Map<string, Value> {
  const values = new Map<string, Value>();

  for (const [key, value] of Object.entries({ ...block }))
    values.set(key, typeof value === "string" ? { text: value } : { cipher: value[SEALED] });

  return values;
}

/** The merged layers of the env `rel` exports, loaded with `import()`; of several, the one no other names as parent. */
export async function loadLayers(root: string, rel: string): Promise<Layers> {
  const file = path.join(root, rel);

  const loaded = (await import(pathToFileURL(file).href)) /* a module namespace is an object */ as Record<
    string,
    unknown
  >;

  const parents = parentsOf(configsOf(sourceOf(rel, fs.readFileSync(file, "utf8"))));

  const envs = Object.entries(loaded).filter(
    (entry): entry is [string, LoadedEnv] => isRecord(entry[1]) && LAYERS in entry[1] && !parents.has(entry[0]),
  );

  const [, env] = envs.at(LAST) ?? refuse(`${rel} exports no defineEnv env`);
  const layers = { ...env[LAYERS] };

  return new Map(SCOPES.map((scope) => [scope, blockValues(layers[scope])]));
}

/** A repo's root and its tracked files, repo-relative. */
export type Tree = { readonly root: string; readonly tracked: readonly string[] };

/** The tracked files that import `rel` and name `key`, sorted; the env file itself is not one. */
export function usersOf({ root, tracked }: Tree, rel: string, key: string): string[] {
  const target = rel.replace(TS_EXTENSION, "");
  const word = new RegExp(`\\b${key}\\b`, "u");

  return tracked.toSorted().filter((user) => {
    if (user === rel || !SCANNED_EXTENSIONS.includes(path.posix.extname(user))) return false;
    const file = path.join(root, user);
    const text = fs.readFileSync(file, "utf8");
    const specifiers = [...text.matchAll(SPECIFIER)].map((match) => String(match[1]));

    const imports = specifiers.some(
      (spec) => path.posix.join(path.posix.dirname(user), spec).replace(TS_EXTENSION, "") === target,
    );

    return imports && word.test(text);
  });
}
