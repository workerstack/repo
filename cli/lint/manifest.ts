import fs from "node:fs";
import path from "node:path";

import { z } from "zod";

import { isRecord, isString, type Json, type JsonObject, tryJson } from "../json.ts";
import { isSource } from "../test-files.ts";

/**
 * What a package.json declares, parsed from untrusted JSON: a field of the wrong shape counts as absent. `bins` are
 * the `bin` paths as written, relative to the manifest's dir. `devOnly` is the names only `devDependencies` declares,
 * `isPublic` is `"private": false`, and `ships` says whether npm packs a package-relative POSIX path as shipped code.
 */
export type Manifest = {
  file: string;
  name: string | null;
  declared: string[];
  bins: string[];
  devOnly: string[];
  isPublic: boolean;
  ships: (rel: string) => boolean;
};

const RUNTIME_MAPS = ["dependencies", "peerDependencies", "optionalDependencies"];
const DEPENDENCY_MAPS = [...RUNTIME_MAPS, "devDependencies"];

/** The fields whose path npm packs whatever `files` says. */
const TARGET_FIELDS = ["main", "module", "types", "bin", "exports"];
const NEGATION = "!";
const LEADING_DOT_SLASH = /^\.\//;
const TRAILING_SLASHES = /\/+$/;
const GLOB_TOKEN = /\*\*\/|\*\*|\*|\?|[.+^${}()|[\]\\]/g;
const GLOB_PARTS = { "*": "[^/]*", "**": ".*", "**/": "(?:.*/)?", "?": "[^/]" } as const;

/** Whether `token` is a glob token `GLOB_PARTS` translates, not a character to escape. */
function isGlobToken(token: string): token is keyof typeof GLOB_PARTS {
  return Object.hasOwn(GLOB_PARTS, token);
}

/** The nearest package.json at or above `start`, or null when none is. */
export function nearestManifest(start: string): string | null {
  let dir = start;

  while (!fs.existsSync(path.join(dir, "package.json"))) {
    if (path.dirname(dir) === dir) return null;
    dir = path.dirname(dir);
  }

  return path.join(dir, "package.json");
}

/** A manifest's bin scripts: `bin` as one path or a map of them; anything else names none. */
export function binsOf(bin: Json | undefined): string[] {
  const all = isRecord(bin) ? Object.values(bin) : [bin];

  return all.filter(isString);
}

/** `./src/` → `src`: the form a `files` entry or a target is matched in. */
function tidy(entry: string): string {
  return entry.replace(LEADING_DOT_SLASH, "").replace(TRAILING_SLASHES, "");
}

/** A matcher for a `files` entry, as npm reads it: a path, a directory (all under it) or a `*`, `**`, `?` glob. */
function entryMatcher(entry: string): (rel: string) => boolean {
  const body = tidy(entry).replaceAll(GLOB_TOKEN, (token) => (isGlobToken(token) ? GLOB_PARTS[token] : `\\${token}`));
  const pattern = new RegExp(`^${body}(?:/.*)?$`);

  return (rel) => pattern.test(rel);
}

/** Every string under a `bin`, `exports` or other target value. */
function stringsIn(value: Json | undefined): string[] {
  if (isString(value)) return [value];

  if (Array.isArray(value)) return value.flatMap(stringsIn);

  return isRecord(value) ? Object.values(value).flatMap(stringsIn) : [];
}

/** Whether npm packs a source file: `files` (a path, directory or glob, minus `!` entries) or a target it names. */
function shipsOf(raw: JsonObject): (rel: string) => boolean {
  const entries = Array.isArray(raw.files) ? raw.files.filter(isString) : null;
  const targets = TARGET_FIELDS.flatMap((key) => stringsIn(raw[key])).map(entryMatcher);

  function listed(entry: string) {
    return entry.startsWith(NEGATION) ? [] : [entryMatcher(entry)];
  }

  function unlisted(entry: string) {
    return entry.startsWith(NEGATION) ? [entryMatcher(entry.slice(1))] : [];
  }

  const included = entries?.flatMap(listed);
  const excluded = entries?.flatMap(unlisted) ?? [];

  return (rel) =>
    isSource(rel) &&
    (targets.some((match) => match(rel)) ||
      ((included === undefined || included.some((match) => match(rel))) && !excluded.some((match) => match(rel))));
}

/** The manifest object in `text`, its name null unless a string; undefined when it is no JSON object. */
function rawManifest(text: string): { name: string | null; [key: string]: Json } | undefined {
  const schema = z.object({ name: z.string().nullable().catch(null) }).catchall(z.json());

  return tryJson(schema, text);
}

/** The manifest `file` holds as `text`, or null when that is no JSON object. */
function parseManifest(file: string, text: string): Manifest | null {
  const raw = rawManifest(text);

  if (raw === undefined) return null;
  const { name } = raw;
  const doc = raw;

  function namesIn(keys: string[]) {
    return keys.flatMap((key) => {
      const map = doc[key];

      return isRecord(map) ? Object.keys(map) : [];
    });
  }

  const runtime = new Set(namesIn(RUNTIME_MAPS));
  const devOnly = namesIn(["devDependencies"]).filter((dep) => !runtime.has(dep));

  return {
    bins: binsOf(raw.bin),
    declared: namesIn(DEPENDENCY_MAPS),
    devOnly,
    file,
    isPublic: raw.private === false,
    name,
    ships: shipsOf(raw),
  };
}

/** A parsed manifest and the text it was parsed from. */
type Parsed = { manifest: Manifest | null; text: string };

/** The text of `file`, or null when it cannot be read. */
function textOf(file: string): string | null {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

/**
 * The reader of manifests, which parses a file again only once its text changes: a lint run asks for the same few
 * manifests for every file and every import it checks, and the editor's linter lives across edits. Reading is cheap;
 * the parse is the cost.
 */
function manifestMemo(): (file: string) => Manifest | null {
  const known = new Map<string, Parsed>();

  return (file) => {
    const text = textOf(file);

    if (text === null) return null;
    const found = known.get(file);

    if (found?.text === text) return found.manifest;
    const manifest = parseManifest(file, text);
    known.set(file, { manifest, text });

    return manifest;
  };
}

/** The manifest at `file`, or null when it cannot be read as a JSON object; parsed again once its text changes. */
export const readManifest: (file: string) => Manifest | null = /* @__PURE__ */ manifestMemo();
