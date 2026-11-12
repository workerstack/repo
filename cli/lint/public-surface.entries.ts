/** The source files a package's code `exports` name. */
import fs from "node:fs";
import path from "node:path";

import { z } from "zod";

import { isRecord, isString, type Json, tryJson } from "../json.ts";
import { BUILD_CONFIG, BUILT_EXTENSIONS, CODE_TARGET } from "./public-surface.constants.ts";
import type { Build } from "./public-surface.types.ts";

/** The package's JSON file at `file` read through `schema`, or null when it is missing, no JSON or of another shape. */
export function readPackageFile<T>(file: string, schema: z.ZodType<T>): T | null {
  try {
    return tryJson(schema, fs.readFileSync(file, "utf8")) ?? null;
  } catch {
    return null;
  }
}

function buildSchema(): z.ZodType<{ compilerOptions: Build }> {
  return z.looseObject({ compilerOptions: z.looseObject({ outDir: z.string(), rootDir: z.string() }) });
}

/** `rootDir` and `outDir` from the package's build config, or null when it names not both. */
function buildOf(root: string): Build | null {
  return readPackageFile(path.join(root, BUILD_CONFIG), buildSchema())?.compilerOptions ?? null;
}

/** The source file behind `target`: a built file in `outDir` maps to its source in `rootDir`, else `target` itself. */
function sourceOf(root: string, build: Build | null, target: string): string {
  const file = path.resolve(root, target);

  if (build === null) return file;
  const built = path.relative(path.resolve(root, build.outDir), file);

  if (built.startsWith("..") || path.isAbsolute(built)) return file;
  let source = built;

  for (const [from, to] of BUILT_EXTENSIONS) source = source.replace(from, to);

  return path.resolve(root, build.rootDir, source);
}

/** Every string in an `exports` value, whether it is a path, a list of them or a map of conditions. */
function targetsOf(value: Json | undefined): string[] {
  if (isString(value)) return [value];

  if (Array.isArray(value)) return value.flatMap(targetsOf);

  return isRecord(value) ? Object.values(value).flatMap(targetsOf) : [];
}

/** The `exports` entries: a map of subpaths, or conditions written straight on `exports`, which mean ".". */
function subpathsOf(exports: Json | undefined): [string, Json | undefined][] {
  if (isRecord(exports) && Object.keys(exports).every((key) => key.startsWith("."))) return Object.entries(exports);

  return [[".", exports]];
}

/**
 * The source files each `exports` key of the package at `root` targets. JSON, wildcard and non-code targets carry no
 * declarations and are skipped, and a key left with no target is left out. A built target maps back to source through
 * `tsconfig.build.json`.
 */
export function entryFiles(root: string, exports: Json | undefined): Map<string, string[]> {
  const build = buildOf(root);
  const found = new Map<string, string[]>();

  for (const [entry, value] of subpathsOf(exports)) {
    const targets = targetsOf(value).filter((target) => CODE_TARGET.test(target) && !target.includes("*"));
    const files = entry.includes("*") ? [] : targets.map((target) => sourceOf(root, build, target));

    if (files.length > 0) found.set(entry, [...new Set(files)]);
  }

  return found;
}
