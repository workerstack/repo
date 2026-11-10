/**
 * What a package exposes: every declaration its code `exports` reach, by name or through a type position, read off the
 * syntax so a lint rule can ask for it. Anything the walk cannot follow lands in `unknown` for the rule to report, since
 * a form skipped in silence would pass a public gap.
 */
import fs from "node:fs";
import path from "node:path";
import { isRecord, nearestManifest } from "./manifest.ts";
import { DEFAULT, MANIFEST, NAMESPACE } from "./public-surface.constants.ts";
import { entryFiles, readJson } from "./public-surface.entries.ts";
import { parseModule } from "./parse-module.ts";
import { referencesOf } from "./public-surface.syntax.ts";
import type {
  Graph,
  Import,
  Link,
  Module,
  Query,
  Reference,
  Resolved,
  Surface,
  Unknown,
} from "./public-surface.types.ts";

export type { Surface } from "./public-surface.types.ts";

function moduleOf(graph: Graph, file: string): Module | null {
  const known = graph.modules.get(file);
  if (known !== undefined) return known;
  let code: string | null = null;
  try {
    code = fs.readFileSync(file, "utf8");
  } catch {
    code = null;
  }
  const module = code === null ? null : parseModule(file, code);
  graph.modules.set(file, module);
  return module;
}

/** Records `found` once, however many entries and stars lead to it. */
function failAt(graph: Graph, found: Unknown): void {
  const key = `${found.file}\0${found.form}\0${found.line}`;
  if (graph.failed.has(key)) return;
  graph.failed.add(key);
  graph.unknown.push(found);
}

function fail(graph: Graph, module: Module, found: { form: string; at: number }): void {
  const line = module.code.slice(0, found.at).split("\n").length;
  failAt(graph, { file: module.file, form: found.form, line });
}

/** The file a relative `source` names from `file`, or null for a package or alias the walk does not enter. */
const targetOf = (file: string, source: string): string | null =>
  source.startsWith(".") ? path.resolve(path.dirname(file), source) : null;

function resolveImported(query: Query, from: string, link: Import): Resolved {
  const target = targetOf(from, link.source);
  if (target === null) return { kind: "external" };
  if (link.name !== NAMESPACE) return resolveExport(query, target, link.name);
  const module = moduleOf(query.graph, target);
  return module === null ? null : { kind: "module", module };
}

function resolveLink(query: Query, module: Module, link: Link): Resolved {
  if (link.source !== null) return resolveImported(query, module.file, { name: link.name, source: link.source });
  const statements = module.locals.get(link.name);
  if (statements !== undefined) return { kind: "name", module, name: link.name, statements };
  const imported = module.imports.get(link.name);
  return imported === undefined ? null : resolveImported(query, module.file, imported);
}

/** What `name` is in `file`: a declaration, a whole module, outside the walk, or null when nothing declares it. */
function resolveExport(query: Query, file: string, name: string): Resolved {
  const visit = `${file}\0${name}`;
  if (query.seen.has(visit)) return null;
  query.seen.add(visit);
  const module = moduleOf(query.graph, file);
  if (module === null) return null;
  const link = module.exports.get(name);
  if (link !== undefined) return resolveLink(query, module, link);
  if (name === DEFAULT) return null;
  for (const star of module.stars) {
    const target = targetOf(file, star.source);
    const resolved = target === null ? null : resolveExport(query, target, name);
    if (resolved !== null) return resolved;
  }
  return null;
}

/** Every name `module` exports, through its stars too; reports the forms and missing stars met on the way. */
function exportNames(graph: Graph, module: Module, seen: Set<Module>): string[] {
  if (seen.has(module)) return [];
  seen.add(module);
  for (const found of module.unknown) fail(graph, module, found);
  const stars = module.stars.flatMap((star) => {
    const target = targetOf(module.file, star.source);
    if (target === null) return [];
    const next = moduleOf(graph, target);
    if (next === null) {
      fail(graph, module, { form: star.source, at: star.at });
      return [];
    }
    return exportNames(graph, next, seen).filter((name) => name !== DEFAULT);
  });
  return [...new Set([...module.exports.keys(), ...stars])];
}

function resolveReference(graph: Graph, module: Module, reference: Reference): Resolved {
  const query = { graph, seen: new Set<string>() };
  if (reference.source !== null) {
    return resolveImported(query, module.file, { name: reference.name, source: reference.source });
  }
  const statements = module.locals.get(reference.name);
  if (statements !== undefined) return { kind: "name", module, name: reference.name, statements };
  const imported = module.imports.get(reference.name);
  if (imported === undefined) return null;
  const member = imported.name === NAMESPACE ? reference.member : null;
  return resolveImported(query, module.file, { name: member ?? imported.name, source: imported.source });
}

function publishResolved(graph: Graph, resolved: Resolved, entry: string): void {
  if (resolved?.kind === "module") publishModule(graph, resolved.module, entry);
  if (resolved?.kind === "name") publishName(graph, resolved, entry);
}

function publishName(graph: Graph, found: Extract<Resolved, { kind: "name" }>, entry: string): void {
  const names = graph.names.get(found.module.file) ?? new Map<string, string>();
  graph.names.set(found.module.file, names);
  if (names.has(found.name)) return;
  names.set(found.name, entry);
  for (const statement of found.statements) {
    for (const reference of referencesOf(statement)) {
      publishResolved(graph, resolveReference(graph, found.module, reference), entry);
    }
  }
}

/** Reports a name `exportNames` found that resolves to nothing: the unreadable file it comes from, else the name. */
function failExport(graph: Graph, module: Module, name: string): void {
  const source = module.exports.get(name)?.source;
  const target = source === undefined || source === null ? null : targetOf(module.file, source);
  const gone = target !== null && moduleOf(graph, target) === null;
  failAt(graph, { file: module.file, form: gone ? String(source) : name, line: 1 });
}

function publishModule(graph: Graph, module: Module, entry: string): void {
  if (graph.published.has(module)) return;
  graph.published.add(module);
  for (const name of exportNames(graph, module, new Set())) {
    const resolved = resolveExport({ graph, seen: new Set() }, module.file, name);
    if (resolved === null) failExport(graph, module, name);
    else publishResolved(graph, resolved, entry);
  }
}

function publishEntry(graph: Graph, file: string, entry: string): void {
  const module = moduleOf(graph, file);
  if (module === null) {
    failAt(graph, { file, form: path.relative(graph.root, file).replaceAll("\\", "/"), line: 1 });
  } else publishModule(graph, module, entry);
}

/**
 * The declarations the package at `root` exposes through its code `exports`, by file, each with the first entry that
 * reaches it, and the forms the walk could not follow. A package is public unless its manifest says `private: true`.
 */
export function publicSurface(root: string): Surface {
  const surface: Surface = { entries: new Map(), names: new Map(), unknown: [] };
  const manifest = readJson(path.join(root, MANIFEST));
  if (!isRecord(manifest) || manifest["private"] === true) return surface;
  const graph: Graph = {
    root,
    modules: new Map(),
    published: new Set(),
    failed: new Set(),
    names: surface.names,
    unknown: surface.unknown,
  };
  surface.entries = entryFiles(root, manifest["exports"]);
  for (const [entry, files] of surface.entries) {
    for (const file of files) publishEntry(graph, file, entry);
  }
  return surface;
}

/** The root of the package that holds `file`: the dir of its nearest package.json, as `boundaries` finds it. */
export function packageRoot(file: string): string | null {
  const manifest = nearestManifest(path.dirname(file));
  return manifest === null ? null : path.dirname(manifest);
}
