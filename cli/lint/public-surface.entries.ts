/** The source files a package's code `exports` name. */
import fs from "node:fs";
import path from "node:path";
import { BUILD_CONFIG, BUILT_EXTENSIONS, CODE_TARGET } from "./public-surface.constants.ts";
import { get } from "./public-surface.syntax.ts";
import type { Build } from "./public-surface.types.ts";
import { isRecord } from "./manifest.ts";

/** The JSON at `file`, or null when it is missing or not JSON. */
export function readJson(file: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

/** `rootDir` and `outDir` from the package's build config, or null when it names not both. */
function buildOf(root: string): Build | null {
  const options = get(readJson(path.join(root, BUILD_CONFIG)), "compilerOptions");
  const rootDir = get(options, "rootDir");
  const outDir = get(options, "outDir");
  return typeof rootDir === "string" && typeof outDir === "string" ? { rootDir, outDir } : null;
}

/** The source file behind `target`: a built file in `outDir` maps to its source in `rootDir`, else `target` itself. */
function sourceOf(root: string, build: Build | null, target: string): string {
  const file = path.resolve(root, target);
  if (build === null) return file;
  const built = path.relative(path.resolve(root, build.outDir), file);
  if (built.startsWith("..") || path.isAbsolute(built)) return file;
  const source = BUILT_EXTENSIONS.reduce((rel, [from, to]) => rel.replace(from, to), built);
  return path.resolve(root, build.rootDir, source);
}

/** Every string in an `exports` value, whether it is a path, a list of them or a map of conditions. */
function targetsOf(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(targetsOf);
  return isRecord(value) ? Object.values(value).flatMap(targetsOf) : [];
}

/** The `exports` entries: a map of subpaths, or conditions written straight on `exports`, which mean ".". */
function subpathsOf(exports: unknown): [string, unknown][] {
  if (isRecord(exports) && Object.keys(exports).every((key) => key.startsWith("."))) return Object.entries(exports);
  return [[".", exports]];
}

/**
 * The source files each `exports` key of the package at `root` targets. JSON, wildcard and non-code targets carry no
 * declarations and are skipped, and a key left with no target is left out. A built target maps back to source through
 * `tsconfig.build.json`.
 */
export function entryFiles(root: string, exports: unknown): Map<string, string[]> {
  const build = buildOf(root);
  const found = new Map<string, string[]>();
  for (const [entry, value] of subpathsOf(exports)) {
    const targets = targetsOf(value).filter((target) => CODE_TARGET.test(target) && !target.includes("*"));
    const files = entry.includes("*") ? [] : targets.map((target) => sourceOf(root, build, target));
    if (files.length > 0) found.set(entry, [...new Set(files)]);
  }
  return found;
}
