import fs from "node:fs";
import { builtinModules } from "node:module";
import path from "node:path";
import type { ESTree, Rule } from "@oxlint/plugins";

/** What a package.json declares, parsed from untrusted JSON: a field of the wrong shape counts as absent. */
type Manifest = { file: string; name: string | null; declared: string[] };
/** The file being linted, its package's manifest, and the dir paths in messages are relative to. */
type Where = { cwd: string; filename: string; own: Manifest };
type Sourced =
  | ESTree.ImportDeclaration
  | ESTree.ExportNamedDeclaration
  | ESTree.ExportAllDeclaration
  | ESTree.ImportExpression;

const DEPENDENCY_MAPS = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"];
/** `node:fs`, `bun:test`, `virtual:x`: a scheme names no installed package. */
const SCHEME = /^[a-z][a-z\d+.-]*:/i;

/** The nearest package.json at or above `start`, or null when none is. */
function nearestManifest(start: string): string | null {
  let dir = start;
  while (!fs.existsSync(path.join(dir, "package.json"))) {
    if (path.dirname(dir) === dir) return null;
    dir = path.dirname(dir);
  }
  return path.join(dir, "package.json");
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** The manifest at `file`, or null when it cannot be read as a JSON object. */
function readManifest(file: string): Manifest | null {
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
  if (!isRecord(raw)) return null;
  const name = typeof raw.name === "string" ? raw.name : null;
  const declared = DEPENDENCY_MAPS.flatMap((key) => {
    const map = raw[key];
    return isRecord(map) ? Object.keys(map) : [];
  });
  return { file, name, declared };
}

/** `@scope/pkg/sub` → `@scope/pkg`; `pkg/sub` → `pkg`. */
function packageName(specifier: string): string {
  const parts = specifier.split("/");
  return parts.slice(0, specifier.startsWith("@") ? 2 : 1).join("/");
}

const exempt = (specifier: string): boolean =>
  specifier.startsWith("#") ||
  SCHEME.test(specifier) ||
  specifier === "bun" ||
  builtinModules.includes(packageName(specifier));

const shown = (cwd: string, to: string): string => path.relative(cwd, to).replaceAll("\\", "/");

/** The message for a path specifier whose target belongs to another package, or null when it stays home. */
function reachProblem(where: Where, specifier: string): string | null {
  const file = nearestManifest(path.resolve(path.dirname(where.filename), specifier));
  if (file === null || file === where.own.file) return null;
  const dir = shown(where.cwd, path.dirname(file)) || "the root package";
  const name = readManifest(file)?.name ?? null;
  return name === null
    ? `"${specifier}" reaches into ${dir}; name it in ${shown(where.cwd, file)} and import it by that name`
    : `"${specifier}" reaches into ${dir}; import it as "${name}"`;
}

function problemOf(where: Where, specifier: string): string | null {
  if (specifier.startsWith(".") || path.isAbsolute(specifier)) return reachProblem(where, specifier);
  const name = packageName(specifier);
  if (exempt(specifier) || name === where.own.name || where.own.declared.includes(name)) return null;
  return `"${name}" is not declared in ${shown(where.cwd, where.own.file)}; add it to its dependencies`;
}

/**
 * Keeps each file to its own package: a path import stays inside its nearest package.json, and a package import is
 * the package itself or one its manifest declares. Type-only imports and `import()` count; a file whose manifest
 * cannot be read is skipped.
 */
export const boundaries = {
  create(context) {
    const ownFile = nearestManifest(path.dirname(context.filename));
    const own = ownFile === null ? null : readManifest(ownFile);
    if (own === null) return {};
    const where: Where = { cwd: context.cwd, filename: context.filename, own };
    const check = (node: Sourced): void => {
      const { source } = node;
      if (source?.type !== "Literal" || typeof source.value !== "string") return;
      const message = problemOf(where, source.value);
      if (message !== null) context.report({ message, node });
    };
    return {
      ImportDeclaration: check,
      ExportNamedDeclaration: check,
      ExportAllDeclaration: check,
      ImportExpression: check,
    };
  },
} satisfies Rule;
