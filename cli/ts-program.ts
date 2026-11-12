/**
 * The compiler options a script checks a file with: those of the `tsconfig.json` nearest above it (its owner), or of a
 * config beside that one, such as the strict `tsconfig.src.json`. Shared by the magic and rejection checks.
 */
import fs from "node:fs";
import path from "node:path";

import ts from "typescript";

import { FIXTURES_DIR } from "./fixtures.constants.ts";
import type { Result } from "./result.ts";
import { RUNTIME_CONFIG } from "./tsconfig.constants.ts";

/** A program's options, and the files its tsconfig includes, as program paths. */
export type Setup = { options: ts.CompilerOptions; fileNames: readonly string[] };

const TOP = ".";
const SOURCE = /\.(?:tsx?|mts|cts)$/;
const DECLARATION = /\.d\.[cm]?ts$/;
const TEST = /\.(?:test|spec|e2e)\./;

/** Code that must not compile, which `check-rejections.ts` checks instead. */
const REJECT = /\.reject\.tsx?$/;
const SKIPPED_DIRS = [FIXTURES_DIR, "e2e", "vendor", "node_modules"];

/** The options a file with no tsconfig.json above it is checked with: strict, resolved as a bundler would. */
const DEFAULTS: ts.CompilerOptions = {
  allowImportingTsExtensions: true,
  module: ts.ModuleKind.Preserve,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  noEmit: true,
  skipLibCheck: true,
  strict: true,
  target: ts.ScriptTarget.ESNext,
};

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

/** The setup of `config` in the owner `dir` (root-relative), the defaults for no owner, or why it cannot be read. */
export function setupOf(root: string, dir: string | null, config: string): Result<Setup> {
  if (dir === null) return { ok: true, value: { fileNames: [], options: DEFAULTS } };
  const file = posix(path.join(root, dir, config));
  const read = ts.readConfigFile(file, (name) => ts.sys.readFile(name));

  if (read.error !== undefined) {
    const message = ts.flattenDiagnosticMessageText(read.error.messageText, " ");

    return { error: [`${path.posix.join(dir, config)}: ${message}`], ok: false };
  }

  const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, path.dirname(file), undefined, file);

  return { ok: true, value: { fileNames: parsed.fileNames, options: { ...parsed.options, noEmit: true } } };
}
