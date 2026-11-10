import path from "node:path";
import { tempDir, write } from "./planted-repo.ts";
import { publicSurface } from "../lint/public-surface.ts";

/** A package at a new temp dir: `manifest` fields beside a `name`, and `files` (path → text, objects as JSON) under it. */
export function packageOf(manifest: Record<string, unknown>, files: Record<string, unknown> = {}): string {
  const root = tempDir();
  write(root, { "package.json": { name: "pkg", ...manifest }, ...files });
  return root;
}

/** A package whose `exports` are `entries`. */
export const withEntries = (entries: unknown, files: Record<string, unknown>): string =>
  packageOf({ exports: entries }, files);

/** `file` relative to `root`, with forward slashes. */
export const rel = (root: string, file: string): string => path.relative(root, file).replaceAll("\\", "/");

/** The names the walk reached in the package at `root`, sorted, by file relative to the root. */
export function namesIn(root: string): Record<string, string[]> {
  const found: Record<string, string[]> = {};
  for (const [file, names] of publicSurface(root).names) found[rel(root, file)] = [...names.keys()].sort();
  return found;
}

/** What the walk could not follow in the package at `root`, by file relative to the root. */
export const unknownIn = (root: string) =>
  publicSurface(root).unknown.map((entry) => ({ ...entry, file: rel(root, entry.file) }));
