import { builtinModules } from "node:module";
import path from "node:path";

import type { ESTree } from "@oxlint/plugins";

import { type Tags, TAGS_SCHEMA, tagProblem, tagsOf } from "./boundaries-tags.ts";
import { BUN_MODULE, SCOPED_PARTS } from "./boundaries.constants.ts";
import { type Manifest, nearestManifest, readManifest } from "./manifest.ts";
import type { RepoRule } from "./rule.types.ts";

/** The file being linted, its package's manifest, the dir paths in messages are relative to, and the package tags. */
type Where = { cwd: string; filename: string; own: Manifest; tags: Tags };
type Sourced =
  | ESTree.ImportDeclaration
  | ESTree.ExportNamedDeclaration
  | ESTree.ExportAllDeclaration
  | ESTree.ImportExpression;

/** `node:fs`, `bun:test`, `virtual:x`: a scheme names no installed package. */
const SCHEME = /^[a-z][a-z\d+.-]*:/i;

/** `@scope/pkg/sub` → `@scope/pkg`; `pkg/sub` → `pkg`. */
function packageName(specifier: string): string {
  const parts = specifier.split("/");
  return parts.slice(0, specifier.startsWith("@") ? SCOPED_PARTS : 1).join("/");
}

function exempt(specifier: string): boolean {
  return (
    specifier.startsWith("#") ||
    SCHEME.test(specifier) ||
    specifier === BUN_MODULE ||
    builtinModules.includes(packageName(specifier))
  );
}

function shown(cwd: string, to: string): string {
  return path.relative(cwd, to).replaceAll("\\", "/");
}

/** The message for a path specifier whose target belongs to another package, or null when it stays home. */
function reachProblem(where: Where, specifier: string): string | null {
  const file = nearestManifest(path.resolve(path.dirname(where.filename), specifier));
  if (file === null || file === where.own.file) return null;
  const shownDir = shown(where.cwd, path.dirname(file));
  const dir = shownDir === "" ? "the root package" : shownDir;
  const name = readManifest(file)?.name ?? null;
  return name === null
    ? `"${specifier}" reaches into ${dir}; name it in ${shown(where.cwd, file)} and import it by that name`
    : `"${specifier}" reaches into ${dir}; import it as "${name}"`;
}

/** True when `name` is only a devDependency and the file is shipped code of a public package. */
function shipsDevOnly({ own, filename }: Where, name: string): boolean {
  if (!own.isPublic || !own.devOnly.includes(name)) return false;
  return own.ships(path.relative(path.dirname(own.file), filename).replaceAll("\\", "/"));
}

function problemOf(where: Where, specifier: string): string | null {
  if (specifier.startsWith(".") || path.isAbsolute(specifier)) return reachProblem(where, specifier);
  const name = packageName(specifier);
  if (exempt(specifier) || name === where.own.name) return null;
  const manifest = shown(where.cwd, where.own.file);
  if (!where.own.declared.includes(name)) return `"${name}" is not declared in ${manifest}; add it to its dependencies`;
  if (!shipsDevOnly(where, name)) return tagProblem(where.tags, where.own.name, name);
  return (
    `"${name}" is only in devDependencies of ${manifest}; ` +
    "shipped code needs it in dependencies or peerDependencies"
  );
}

/**
 * Keeps each file to its own package: a path import stays inside its nearest package.json, and a package import is
 * the package itself or one its manifest declares. Type-only imports and `import()` count; a file whose manifest
 * cannot be read is skipped. In a public package a shipped file also needs a runtime name: one only in
 * `devDependencies` is not installed by a consumer. With `lint.boundaries`, which sync writes as its options, a
 * package import also needs the importer's tag to allow the target's.
 */
export const boundaries: RepoRule = {
  create(context) {
    const ownFile = nearestManifest(path.dirname(context.filename));
    const own = ownFile === null ? null : readManifest(ownFile);
    if (own === null) return {};
    const where: Where = { cwd: context.cwd, filename: context.filename, own, tags: tagsOf(context.options) };
    function check(node: Sourced): void {
      const { source } = node;
      if (source?.type !== "Literal" || typeof source.value !== "string") return;
      const message = problemOf(where, source.value);
      if (message !== null) context.report({ message, node });
    }
    return {
      ExportAllDeclaration: check,
      ExportNamedDeclaration: check,
      ImportDeclaration: check,
      ImportExpression: check,
    };
  },
  meta: { schema: TAGS_SCHEMA },
};
