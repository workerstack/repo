import fs from "node:fs";
import path from "node:path";

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
const GLOB_PARTS: Record<string, string> = { "*": "[^/]*", "**": ".*", "**/": "(?:.*/)?", "?": "[^/]" };

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
export function binsOf(bin: unknown): string[] {
  const all = isRecord(bin) ? Object.values(bin) : [bin];

  return all.filter((file) => typeof file === "string");
}

/** `./src/` → `src`: the form a `files` entry or a target is matched in. */
function tidy(entry: string): string {
  return entry.replace(LEADING_DOT_SLASH, "").replace(TRAILING_SLASHES, "");
}

/** A matcher for a `files` entry, as npm reads it: a path, a directory (all under it) or a `*`, `**`, `?` glob. */
function entryMatcher(entry: string): (rel: string) => boolean {
  const body = tidy(entry).replaceAll(GLOB_TOKEN, (token) => GLOB_PARTS[token] ?? `\\${token}`);
  const pattern = new RegExp(`^${body}(?:/.*)?$`);

  return (rel) => pattern.test(rel);
}

/** Every string under a `bin`, `exports` or other target value. */
function stringsIn(value: unknown): string[] {
  if (typeof value === "string") return [value];

  if (Array.isArray(value)) return value.flatMap(stringsIn);

  return isRecord(value) ? Object.values(value).flatMap(stringsIn) : [];
}

/** Whether npm packs a source file: `files` (a path, directory or glob, minus `!` entries) or a target it names. */
function shipsOf(raw: Record<string, unknown>): (rel: string) => boolean {
  const entries = Array.isArray(raw.files) ? raw.files.filter((entry) => typeof entry === "string") : null;
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

/** The manifest at `file`, or null when it cannot be read as a JSON object. */
export function readManifest(file: string): Manifest | null {
  let raw: unknown;

  try {
    raw = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }

  if (!isRecord(raw)) return null;
  const name = typeof raw.name === "string" ? raw.name : null;
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
