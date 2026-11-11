import fs from "node:fs";
import path from "node:path";

import { JSON_INDENT } from "./json.constants.ts";

/** The root-relative paths sync wrote last run, tracked or not; only these are ever pruned. */
export const MANIFEST_REL = ".repo/tmp/sync.json";

export type Manifest = { version: 1; paths: string[] };

/** The manifest on disk; a missing, unreadable or invalid one reads as empty, so nothing is pruned. */
export function readManifest(root: string): Manifest {
  try {
    const data: unknown = JSON.parse(fs.readFileSync(path.join(root, MANIFEST_REL), "utf8"));
    if (typeof data === "object" && data !== null) {
      const version: unknown = Reflect.get(data, "version");
      const paths: unknown = Reflect.get(data, "paths");
      if (version === 1 && Array.isArray(paths) && paths.every((entry) => typeof entry === "string"))
        return { paths: paths, version: 1 };
    }
  } catch {
    // falls through to the empty manifest
  }
  return { paths: [], version: 1 };
}

/** The manifest file text for `paths`: deduped and sorted, so equal sets give equal bytes. */
export function renderManifest(paths: readonly string[]): string {
  const manifest: Manifest = { paths: [...new Set(paths)].sort(), version: 1 };
  return `${JSON.stringify(manifest, null, JSON_INDENT)}\n`;
}

/**
 * One root-relative POSIX spelling of `raw`: backslashes become `/`, `./` and doubled separators go, and an
 * absolute path under `root` (either spelling, drive letter case-insensitive) is made relative. Null for a path
 * that is empty, outside `root` or climbs with `..`, so such a path is never matched, written or pruned.
 */
export function normalizeRel(raw: string, root: string): string | null {
  const slash = (text: string) => text.replaceAll("\\", "/").replaceAll(/\/+/g, "/");
  let rel = slash(raw);
  if (/^[A-Za-z]:\//.test(rel) || rel.startsWith("/")) {
    const base = `${slash(root).replace(/\/$/, "")}/`;
    const drive = /^[A-Za-z]:/.test(base);
    const head = rel.slice(0, base.length);
    if (drive ? head.toLowerCase() !== base.toLowerCase() : head !== base) return null;
    rel = rel.slice(base.length);
  }
  const parts = rel.split("/").filter((part) => part !== "" && part !== ".");
  if (parts.length === 0 || parts.includes("..")) return null;
  return parts.join("/");
}

/** The normalized paths of `prev` that no output names; `outputPaths` must already be normalized. */
export function prunePaths(prev: Manifest, outputPaths: Iterable<string>, root: string): string[] {
  const keep = new Set(outputPaths);
  const stale = new Set<string>();
  for (const raw of prev.paths) {
    const rel = normalizeRel(raw, root);
    if (rel !== null && !keep.has(rel)) stale.add(rel);
  }
  return [...stale].sort();
}
