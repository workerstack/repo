/**
 * The files a package's exported types start from. Each `exports` key gives a types target: its `types` condition, a
 * `.ts` runtime target, or the declaration beside a script target when one exists; without `exports`, `types`,
 * `typings` or `main` stands for the root key. A `*` key is expanded against the files npm packs under its target's
 * static dir and the outputs tsconfig.build.json would emit, minus the keys a `null` key excludes; each file an
 * extensionless target matches is read by its own extension. A `.d.ts` target the build emits is read from its source.
 */
import fs from "node:fs";
import path from "node:path";

import { buildOutputs } from "./build-outputs.ts";
import { isRecord, type Json, type JsonObject } from "./json.ts";
import { packedUnder } from "./packed-under.ts";
import { CURRENT_DIR, JSON_FILE, ROOT_KEY, STAR, TYPES_CONDITION } from "./release/consumer.constants.ts";
import { exportSubpaths } from "./release/exports.ts";
import type { PackageJson } from "./sync/workspace.ts";
import { fieldsOf } from "./type-surface-blame.ts";
import {
  DECLARATION,
  MANIFEST,
  NAME_STAND_IN,
  SCRIPT,
  SIBLING_DECLARATION,
  TSCONFIG_FIELDS,
  TYPESCRIPT,
} from "./type-surface.constants.ts";

/**
 * An export key whose types file, package-relative, is absent: a source target that is gone, a declaration target
 * with no build config to map it, or one tsconfig.build.json emits nothing to.
 */
export type MissingTypes = { cause: "source" | "unmapped" | "unbuilt"; key: string; types: string };

/** A file a scan starts from, with its export key: a source to compile, or a declaration read as it is. */
type Root = { key: string; file: string; compile: boolean };

export type Entries = { roots: Root[]; missing: MissingTypes[] };

/** How a target file is read: as types, as a script whose declaration may sit beside it, or as a json export. */
type Mode = "types" | "sibling" | "json";

/** The file one export value types, a `*` left in place; a null mode reads each matched file by its extension. */
type Target = { pattern: string; mode: Mode | null };

/** The package, its build outputs, its `files` field and its `exports` keys, and what is found so far. */
type Context = {
  dir: string;
  build: Map<string, string> | undefined;
  files: Json | undefined;
  keys: string[];
  entries: Entries;
};

/** The keys and files a key and target stand for, and whether a `*` target matched any file before any was dropped. */
type Matches = { isMatched: boolean; matches: (readonly [string, string])[] };

/** The `exports` field as a map of keys; a string, array or condition object stands for the root key. */
function keyMapOf(exports: Json | undefined): JsonObject {
  if (isRecord(exports) && Object.keys(exports).every((key) => key.startsWith(ROOT_KEY))) return exports;

  return { [ROOT_KEY]: exports ?? null };
}

function modeOf(file: string): Mode | null {
  if (JSON_FILE.test(file)) return "json";

  if (TYPESCRIPT.test(file)) return "types";

  return SCRIPT.test(file) ? "sibling" : null;
}

function targetOf(value: Json): Target | null {
  const [subpath] = exportSubpaths({ [ROOT_KEY]: value }, []).subpaths;

  if (subpath === undefined) {
    const types = isRecord(value) ? value[TYPES_CONDITION] : null;

    return typeof types === "string" ? { mode: "types", pattern: types } : null;
  }

  if (subpath.types !== null) return { mode: "types", pattern: subpath.types };
  const mode = modeOf(subpath.runtime);

  return { mode, pattern: mode === "sibling" ? subpath.runtime.replace(SCRIPT, SIBLING_DECLARATION) : subpath.runtime };
}

/** The text a `*` pattern's star stands for in `text`; undefined when the pattern does not match it. */
function captureOf(pattern: string, text: string): string | undefined {
  const star = pattern.indexOf(STAR);
  const before = pattern.slice(0, star);
  const after = pattern.slice(star + STAR.length);
  const isMatch = text.length > before.length + after.length && text.startsWith(before) && text.endsWith(after);

  return isMatch ? text.slice(before.length, text.length - after.length) : undefined;
}

/** Node's PATTERN_KEY_COMPARE for two `*` keys: below 0 when `a` is more specific, by longer base, then longer key. */
function compareKeys(a: string, b: string): number {
  const byBase = b.indexOf(STAR) - a.indexOf(STAR);

  return byBase === 0 ? b.length - a.length : byBase;
}

/**
 * Whether Node resolves `subkey` through the `*` key `from`: no exact key names it and no more specific `*` key
 * matches it. So a `null` key, or one whose every condition is `null`, hides what it wins.
 */
function isResolvedBy({ keys }: Context, from: string, subkey: string): boolean {
  if (keys.includes(subkey)) return false;

  return !keys.some((key) => key.includes(STAR) && compareKeys(key, from) < 0 && captureOf(key, subkey) !== undefined);
}

/** Each key and file a key and target stand for: themselves, or one per packed file it resolves when both have `*`. */
function matchesOf(context: Context, key: string, pattern: string): Matches {
  if (!key.includes(STAR) || !pattern.includes(STAR)) return { isMatched: true, matches: [[key, pattern]] };
  const { dir, build, files } = context;
  const relative = pattern.slice(CURRENT_DIR.length);
  const staticDir = path.posix.dirname(relative.slice(0, relative.indexOf(STAR)) + NAME_STAND_IN);
  const built = [...(build?.keys() ?? [])].map((file) => path.relative(dir, file));

  const found = packedUnder(dir, staticDir, { extra: built, files }).flatMap(({ file, isPacked }) => {
    const captured = captureOf(relative, file);

    return captured === undefined ? [] : [{ file, isPacked, subkey: key.replace(STAR, captured) }];
  });

  const kept = found.filter(({ isPacked, subkey }) => isPacked && isResolvedBy(context, key, subkey));

  return { isMatched: found.length > 0, matches: kept.map(({ subkey, file }) => [subkey, file] as const) };
}

/** The `.d.ts` files a json export that is a tsconfig lists in its `files`; the ones that exist. */
function shippedDeclarations(file: string): string[] {
  const fields = fieldsOf(file);
  const isTsconfig = path.basename(file) !== MANIFEST && TSCONFIG_FIELDS.some((field) => field in fields);
  const names: unknown[] = isTsconfig && Array.isArray(fields.files) ? fields.files : [];

  return names
    .filter((name): name is string => typeof name === "string" && DECLARATION.test(name))
    .map((name) => path.resolve(path.dirname(file), name))
    .filter((name) => fs.existsSync(name));
}

function causeOf({ build }: Context, target: string): MissingTypes["cause"] {
  if (!DECLARATION.test(target)) return "source";

  return build === undefined ? "unmapped" : "unbuilt";
}

/** Adds a key's types file as a root: its built source, a source, or a declaration; or as missing. */
function place(context: Context, key: string, types: string): void {
  const { dir, build, entries } = context;
  const target = path.join(dir, types);
  const source = DECLARATION.test(target) ? build?.get(target) : target;

  if (source !== undefined && TYPESCRIPT.test(source) && fs.existsSync(source))
    entries.roots.push({ compile: true, file: source, key });
  else if (fs.existsSync(target)) entries.roots.push({ compile: false, file: target, key });
  else entries.missing.push({ cause: causeOf(context, target), key, types: path.relative(dir, target) });
}

/** Adds one matched file of a key, read in its mode; a script's sibling declaration only when it exists. */
function addFile(context: Context, [key, file]: readonly [string, string], mode: Mode | null): void {
  const { dir, entries } = context;
  const sibling = file.replace(SCRIPT, SIBLING_DECLARATION);

  if (mode === "json") {
    const shipped = shippedDeclarations(path.join(dir, file));
    entries.roots.push(...shipped.map((name) => ({ compile: false, file: name, key })));
  } else if (mode === "types") {
    place(context, key, file);
  } else if (mode === "sibling" && fs.existsSync(path.join(dir, sibling))) {
    place(context, key, sibling);
  }
}

function addKey(context: Context, key: string, { pattern, mode }: Target): void {
  const { isMatched, matches } = matchesOf(context, key, pattern);

  if (!isMatched && mode === "types") place(context, key, pattern);

  for (const match of matches) addFile(context, match, mode ?? modeOf(match[1]));
}

/** The files the types of `dir`'s exports start from, and the keys whose types file is absent. */
export function entriesOf(dir: string, manifest: PackageJson): Entries {
  const raw = fieldsOf(path.join(dir, MANIFEST));
  const keyMap = keyMapOf(manifest.exports ?? raw.types ?? raw.typings ?? raw.main);
  const entries: Entries = { missing: [], roots: [] };
  const context: Context = { build: buildOutputs(dir), dir, entries, files: raw.files, keys: Object.keys(keyMap) };

  for (const [key, value] of Object.entries(keyMap)) {
    const target = targetOf(value);

    if (target !== null) addKey(context, key, target);
  }

  return entries;
}
