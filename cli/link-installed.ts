import fs from "node:fs";
import path from "node:path";

import { z } from "zod";

import { tryJson } from "./json.ts";
import { MARKER_FILE, MODULES, SCOPE_PREFIX } from "./link.constants.ts";
import { readJsonFile } from "./package-json.ts";

/** The package.json fields linking reads. */
export type Manifest = {
  bin?: string | Record<string, string> | undefined;
  dependencies?: Record<string, string> | undefined;
  name: string;
  peerDependencies?: Record<string, string> | undefined;
  peerDependenciesMeta?: Record<string, { optional?: boolean | undefined }> | undefined;
  version: string;
};

/** What a `.repo-link` marker records: the package and the directory it was packed from. */
export type Marker = { name: string; source: string };

function manifestSchema(): z.ZodType<Manifest> {
  const ranges = z.record(z.string(), z.string());

  return z.object({
    bin: z.union([z.string(), ranges]).optional(),
    dependencies: ranges.optional(),
    name: z.string(),
    peerDependencies: ranges.optional(),
    peerDependenciesMeta: z.record(z.string(), z.object({ optional: z.boolean().optional() })).optional(),
    version: z.string(),
  });
}

function markerSchema(): z.ZodType<Marker> {
  return z.object({ name: z.string(), source: z.string() });
}

/** The install's file at `file` read through `schema`, or null when it is missing, no JSON, or of another shape. */
function readInstalled<T>(file: string, schema: z.ZodType<T>): T | null {
  if (!fs.existsSync(file)) return null;

  return tryJson(schema, fs.readFileSync(file, "utf8")) ?? null;
}

/** Where `name` sits in `root`'s install dir. */
export function installedDir(root: string, name: string): string {
  return path.join(root, MODULES, name);
}

/** The package.json of the package in `dir`, or null when there is none or it names no package. */
function readManifest(dir: string): Manifest | null {
  return readInstalled(path.join(dir, "package.json"), manifestSchema());
}

/** The package.json of the package in `dir`; throws when it is missing or names no package and version. */
export function requireManifest(dir: string): Manifest {
  return readJsonFile(path.join(dir, "package.json"), manifestSchema());
}

/** The version in `dir`'s package.json, or null when there is none. */
export function readVersion(dir: string): string | null {
  return readManifest(dir)?.version ?? null;
}

/** The marker of the swapped copy of `name`, or null for an npm copy. */
function markerOf(root: string, name: string): Marker | null {
  return readInstalled(path.join(installedDir(root, name), MARKER_FILE), markerSchema());
}

function namesIn(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const entries = fs.readdirSync(dir, { withFileTypes: true }).filter((entry) => entry.isDirectory());

  return entries.flatMap((entry) =>
    entry.name.startsWith(SCOPE_PREFIX)
      ? namesIn(path.join(dir, entry.name)).map((name) => `${entry.name}/${name}`)
      : [entry.name],
  );
}

/** The swapped copies in `root`'s install dir, by package name. */
export function markersIn(root: string): Marker[] {
  const names = namesIn(path.join(root, MODULES)).toSorted();

  return names.flatMap((name) => {
    const marker = markerOf(root, name);

    return marker === null ? [] : [{ name, source: marker.source }];
  });
}

/** The npm version a swap replaces: the one recorded when the copy is already swapped, else what is installed. */
export function npmBefore(root: string, name: string, recorded: string | null): string | null {
  return markerOf(root, name) === null ? (readVersion(installedDir(root, name)) ?? recorded) : recorded;
}
