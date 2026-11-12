import fs from "node:fs";
import path from "node:path";

import { z } from "zod";

import { tryJson } from "../json.ts";
import { JSON_INDENT } from "./json.constants.ts";

/** The root-relative paths sync wrote last run, tracked or not; only these are ever pruned. */
export const MANIFEST_REL = ".repo/tmp/sync.json";

export type Manifest = { version: 1; paths: string[] };

function manifestSchema() {
  return z.object({ paths: z.array(z.string()), version: z.literal(1) });
}

/** The manifest on disk; a missing, unreadable or invalid one reads as empty, so nothing is pruned. */
export function readManifest(root: string): Manifest {
  try {
    const read = tryJson(manifestSchema(), fs.readFileSync(path.join(root, MANIFEST_REL), "utf8"));

    if (read !== undefined) return read;
  } catch {
    // falls through to the empty manifest
  }

  return { paths: [], version: 1 };
}

/** The manifest file text for `paths`: deduped and sorted, so equal sets give equal bytes. */
export function renderManifest(paths: readonly string[]): string {
  const manifest: Manifest = { paths: [...new Set(paths)].toSorted(), version: 1 };

  return `${JSON.stringify(manifest, null, JSON_INDENT)}\n`;
}

const SLASH_RUNS = /\/+/g;
const DRIVE_SLASH = /^[A-Za-z]:\//;
const TRAILING_SLASH = /\/$/;
const DRIVE = /^[A-Za-z]:/;

function slash(text: string): string {
  return text.replaceAll("\\", "/").replaceAll(SLASH_RUNS, "/");
}

/**
 * One root-relative POSIX spelling of `raw`: backslashes become `/`, `./` and doubled separators go, and an
 * absolute path under `root` (either spelling, drive letter case-insensitive) is made relative. Null for a path
 * that is empty, outside `root` or climbs with `..`, so such a path is never matched, written or pruned.
 */
export function normalizeRel(raw: string, root: string): string | null {
  let rel = slash(raw);

  if (DRIVE_SLASH.test(rel) || rel.startsWith("/")) {
    const base = `${slash(root).replace(TRAILING_SLASH, "")}/`;
    const drive = DRIVE.test(base);
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

  return [...stale].toSorted();
}
