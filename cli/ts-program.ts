/**
 * Which files the scripts check, the `tsconfig.json` that owns each (the nearest above it), and typescript's path
 * spelling. Shared by the magic, guard, rejection and type surface checks.
 */
import fs from "node:fs";
import path from "node:path";

import { FIXTURES_DIR } from "./fixtures.constants.ts";
import { RUNTIME_CONFIG } from "./tsconfig.constants.ts";

const TOP = ".";
const SOURCE = /\.(?:tsx?|mts|cts)$/;
const DECLARATION = /\.d\.[cm]?ts$/;
const TEST = /\.(?:test|spec|e2e)\./;

/** Code that must not compile, which `check-rejections.ts` checks instead. */
const REJECT = /\.reject\.tsx?$/;
const SKIPPED_DIRS = [FIXTURES_DIR, "e2e", "vendor", "node_modules"];

/**
 * Whether a root-relative file is TypeScript outside a fixture, e2e or vendored dir, and not a declaration or reject
 * file.
 */
function isScripted(rel: string): boolean {
  const dirs = path.posix.dirname(rel).split("/");
  const skipped = DECLARATION.test(rel) || REJECT.test(rel) || dirs.some((dir) => SKIPPED_DIRS.includes(dir));

  return SOURCE.test(rel) && !skipped;
}

/**
 * A root-relative source file the script checks read: TypeScript, not a declaration, test, fixture, e2e or vendored
 * file.
 */
export function isChecked(rel: string): boolean {
  return isScripted(rel) && !TEST.test(path.posix.basename(rel));
}

/** A root-relative test file whose asserts the script checks read: a TypeScript test outside a fixture or e2e dir. */
export function isTest(rel: string): boolean {
  return isScripted(rel) && TEST.test(path.posix.basename(rel));
}

/** `file` with forward slashes on every platform, the spelling typescript keys its source files by. */
export function posix(file: string): string {
  return file.replaceAll("\\", "/");
}

/** The root-relative dir of the tsconfig.json nearest above `rel`, up to the root; null when there is none. */
export function ownerOf(root: string, rel: string): string | null {
  let dir = path.posix.dirname(rel);

  for (;;) {
    if (fs.existsSync(path.join(root, dir, RUNTIME_CONFIG))) return dir;

    if (dir === TOP) return null;
    dir = path.posix.dirname(dir);
  }
}

/** `files` (root-relative POSIX paths) as program paths under `real`, grouped by the dir of their owning tsconfig. */
export function byOwner(real: string, files: readonly string[]): Map<string | null, string[]> {
  const groups = new Map<string | null, string[]>();

  for (const rel of files) {
    const dir = ownerOf(real, rel);
    groups.set(dir, [...(groups.get(dir) ?? []), path.posix.join(real, rel)]);
  }

  return groups;
}
