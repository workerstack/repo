/** The defineEnv files of a repo: found among tracked files, read with oxc-parser, loaded, and their users. */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import type { Expression, ObjectExpression, ObjectProperty } from "oxc-parser";
import { z } from "zod";

import { DEFINE_ENV_CALL, SCANNED_EXTENSIONS } from "../check-env-values.constants.ts";
import {
  defineCalls,
  isAssignment,
  keyName,
  nameOf,
  sourceOf,
  topDeclarations,
  unwrapped,
  type DefineCall,
  type Source,
} from "../env-syntax.ts";
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

/** The object literal a call is given, inline or by the name of a top-level variable; undefined for anything else. */
function configOf(source: Source, { call }: DefineCall): ObjectExpression | undefined {
  const argument = call.arguments.slice(0, 1).map(unwrapped);
  const named = new Set(argument.flatMap((node) => (node.type === "Identifier" ? [node.name] : [])));

  const held = topDeclarations(source.program)
    .flatMap((statement) => statement.declarations)
    .filter((declaration) => named.has(nameOf(declaration.id) ?? ""))
    .flatMap((declaration) => (declaration.init === null ? [] : [unwrapped(declaration.init)]));

  return [...argument, ...held].find((node): node is ObjectExpression => node.type === "ObjectExpression");
}

/** The configs of every defineEnv call of `source` that it can read. */
function configsOf(source: Source): ObjectExpression[] {
  return defineCalls(source.program).flatMap((call) => configOf(source, call) ?? []);
}

/** The `key: value` members of an object literal whose key is a plain name, by name. */
export function propertiesOf(node: ObjectExpression): Map<string, ObjectProperty> {
  const found = new Map<string, ObjectProperty>();

  for (const member of node.properties.filter(isAssignment)) {
    const name = keyName(member);

    if (name !== undefined) found.set(name, member);
  }

  return found;
}

/** The names the configs of `source` give as `parent`. */
function parentsOf(configs: readonly ObjectExpression[]): Set<string> {
  const parents = configs.flatMap((config) => {
    const value: Expression | undefined = propertiesOf(config).get(PARENT)?.value;

    return value?.type === "Identifier" ? [value.name] : [];
  });

  return new Set(parents);
}

/** The config of the env `source` stands for: of several, the last that no other names as its parent. */
export function mainConfig(source: Source): ObjectExpression | undefined {
  const parents = parentsOf(configsOf(source));
  const children = defineCalls(source.program).filter((call) => !parents.has(call.binding));

  return children.map((call) => configOf(source, call)).at(LAST);
}

/** Every value the defineEnv configs of `source` declare in their own global and scope blocks. */
function declaredIn(source: Source): Declared[] {
  return configsOf(source).flatMap((config) => {
    const blocks = propertiesOf(config);

    return SCOPES.flatMap((scope) => {
      const block = blocks.get(scope)?.value;

      if (block?.type !== "ObjectExpression") return [];

      return [...propertiesOf(block)].map(([key, { value }]): Declared => {
        const isSealed =
          value.type === "CallExpression" && source.text.slice(value.callee.start, value.callee.end) === SEALED_NAME;

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

    // The text check is cheap; only a real call in the syntax tree makes an env file, not one named in a string or a
    // comment. A file that does not parse declares nothing but stays one, so a verb names its parse error.
    const source = text.includes(DEFINE_ENV_CALL) ? sourceOf(rel, text) : undefined;

    if (source !== undefined && (source.isBroken || defineCalls(source.program).length > 0))
      found.set(rel, declaredIn(source));
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

/** A defineEnv env as loaded: its merged blocks by name, each value plain text or a sealed brand. */
type LoadedValue = string | { readonly [SEALED]: string };

type LoadedEnv = { readonly [LAYERS]: Readonly<Record<string, Readonly<Record<string, LoadedValue>>>> };

/** Whether a module export is a defineEnv env: an object that carries the merged layers. */
function isLoadedEnv(value: unknown): value is LoadedEnv {
  return typeof value === "object" && value !== null && LAYERS in value;
}

/** A module namespace read as its named exports, each a defineEnv env or null. */
function namespaceSchema() {
  return z.record(z.string(), z.custom<LoadedEnv>(isLoadedEnv).nullable().catch(null));
}

/** True for a plain string value, false for a sealed brand. */
function isText(value: LoadedValue): value is string {
  return typeof value === "string";
}

/** A merged block's values: a string as text, a sealed brand as its cipher. */
function blockValues(block: Readonly<Record<string, LoadedValue>> | undefined): Map<string, Value> {
  const values = new Map<string, Value>();

  for (const [key, value] of Object.entries({ ...block }))
    values.set(key, isText(value) ? { text: value } : { cipher: value[SEALED] });

  return values;
}

/** The merged layers of the env `rel` exports, loaded with `import()`; of several, the one no other names as parent. */
export async function loadLayers(root: string, rel: string): Promise<Layers> {
  const file = path.join(root, rel);

  const loaded = namespaceSchema().parse(await import(pathToFileURL(file).href));

  const parents = parentsOf(configsOf(sourceOf(rel, fs.readFileSync(file, "utf8"))));

  const envs = Object.entries(loaded).filter(
    (entry): entry is [string, LoadedEnv] => entry[1] !== null && !parents.has(entry[0]),
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
