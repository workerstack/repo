/**
 * Which deps the used packages count against: a package the manifest declares counts for itself only, and one it
 * declares in no field also counts for the deps one hop up.
 */
import fs from "node:fs";

import { parse } from "jsonc-parser";
import ts from "typescript";
import { z } from "zod";

import { dependencyNames } from "./dependency-names.ts";
import { isRecord, type JsonObject } from "./json.ts";
import { byCodeUnit } from "./sync/by-code-unit.ts";
import type { PackageJson } from "./sync/workspace.ts";
import { installedManifest } from "./type-surface.constants.ts";

/** A JSON or JSONC file's top-level fields; none for a file that is missing, unreadable or holds no object. */
export function fieldsOf(file: string | undefined): JsonObject {
  if (file === undefined) return {};
  let text: unknown;

  try {
    text = parse(fs.readFileSync(file, "utf8"));
  } catch {
    return {};
  }

  const parsed = z.json().safeParse(text);

  return parsed.success && isRecord(parsed.data) ? parsed.data : {};
}

/** Each installed package with the deps whose own manifest lists it in `dependencies`. */
function parentsOf(dir: string, deps: readonly string[]): Map<string, string[]> {
  const parents = new Map<string, string[]>();

  for (const dep of deps) {
    const manifest = ts.findConfigFile(dir, (file) => ts.sys.fileExists(file), installedManifest(dep));
    const { dependencies } = fieldsOf(manifest);

    for (const child of Object.keys(isRecord(dependencies) ? dependencies : {}))
      parents.set(child, [...(parents.get(child) ?? []), dep]);
  }

  return parents;
}

/** The used packages, each also counted for the deps one hop up when the manifest declares it in no field; sorted. */
export function blame(used: Map<string, Set<string>>, dir: string, manifest: PackageJson): Map<string, string[]> {
  const deps = Object.keys(manifest.dependencies ?? {});
  const declared = dependencyNames(manifest);
  const parents = parentsOf(dir, deps);
  const uses = new Map<string, Set<string>>();

  for (const [name, files] of used) {
    for (const target of declared.includes(name) ? [name] : [name, ...(parents.get(name) ?? [])])
      uses.set(target, new Set([...(uses.get(target) ?? []), ...files]));
  }

  const sorted = [...uses].toSorted(([a], [b]) => byCodeUnit(a, b));

  return new Map(sorted.map(([name, files]) => [name, [...files].toSorted(byCodeUnit)]));
}
