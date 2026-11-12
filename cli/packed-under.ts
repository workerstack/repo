/**
 * The files of a package under one of its dirs that npm would pack: the ones its `files` field lists (paths, dirs or
 * globs, minus `!` entries), or without `files` every file but a test or a fixture. Installed and VCS dirs are never
 * walked, and a dir below the start that cannot be read is skipped.
 */
import fs from "node:fs";
import path from "node:path";

import { FIXTURES_DIR } from "./fixtures.constants.ts";
import { byCodeUnit } from "./sync/by-code-unit.ts";
import { isTestFile } from "./test-files.ts";
import { INSTALLED_DIR } from "./type-surface.constants.ts";

/** The dirs a walk never enters. */
const SKIPPED_DIRS: readonly string[] = [INSTALLED_DIR, ".git"];

const NEGATION = "!";
const LEADING_DOT_SLASH = /^\.?\//;
const TRAILING_SLASHES = /\/+$/;
const FIXTURE_PATH: Readonly<RegExp> = /* @__PURE__ */ new RegExp(`(^|/)${FIXTURES_DIR}/`);

/** The entries of a dir below the start; none when it cannot be read. */
function readable(dir: string): fs.Dirent[] {
  try {
    return fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

/** The package-relative files under `sub`, given its entries. */
function filesUnder(dir: string, sub: string, entries: fs.Dirent[]): string[] {
  return entries.flatMap((entry) => {
    const name = path.posix.join(sub, entry.name);

    if (!entry.isDirectory()) return [name];

    return SKIPPED_DIRS.includes(entry.name) ? [] : filesUnder(dir, name, readable(path.join(dir, name)));
  });
}

/** Matchers for `files` entries: each as a path or glob, and as a dir holding everything under it. */
function globsOf(entries: readonly string[]): Bun.Glob[] {
  return entries
    .map((entry) => entry.replace(LEADING_DOT_SLASH, "").replace(TRAILING_SLASHES, ""))
    .flatMap((entry) => [new Bun.Glob(entry), new Bun.Glob(`${entry}/**`)]);
}

/** Whether npm packs a package-relative file, per the manifest's `files` field. */
function packedBy(files: unknown): (file: string) => boolean {
  if (!Array.isArray(files)) return (file) => !isTestFile(file) && !FIXTURE_PATH.test(file);
  const entries = files.filter((entry): entry is string => typeof entry === "string");
  const included = globsOf(entries.filter((entry) => !entry.startsWith(NEGATION)));
  const negated = entries.filter((entry) => entry.startsWith(NEGATION));
  const excluded = globsOf(negated.map((entry) => entry.slice(NEGATION.length)));

  return (file) => included.some((glob) => glob.match(file)) && !excluded.some((glob) => glob.match(file));
}

/** The manifest's `files` field, and files beyond the walk, such as build outputs, to judge the same way. */
type Packing = { files: unknown; extra: readonly string[] };

/** A package-relative file, and whether npm packs it. */
export type Packed = { file: string; isPacked: boolean };

/**
 * The package-relative files under `sub` of the package at `dir`, plus the `extra` files, each with whether npm
 * packs it per `files`. `sub` itself must be a readable dir, or this throws.
 */
export function packedUnder(dir: string, sub: string, { files, extra }: Packing): Packed[] {
  const isPacked = packedBy(files);
  const start = path.join(dir, sub);
  const onDisk = fs.existsSync(start) ? filesUnder(dir, sub, fs.readdirSync(start, { withFileTypes: true })) : [];

  return [...new Set([...onDisk, ...extra])].toSorted(byCodeUnit).map((file) => ({ file, isPacked: isPacked(file) }));
}
