import fs from "node:fs";
import path from "node:path";

import type { NameStatus } from "./red-proof.ts";
import { isSource, isTestFile } from "./test-files.ts";

/** The package that owns a file: its dir relative to the root (`.` for the root), and whether it is public. */
export type Owner = { dir: string; public: boolean };

/** Whether the manifest at `file` leaves the package public (`private` is not `true`); a missing or invalid one does not. */
function isPublic(file: string): boolean {
  try {
    return (
      (JSON.parse(fs.readFileSync(file, "utf8")) /* only private is read */ as { private?: unknown }).private !== true
    );
  } catch {
    return false;
  }
}

/**
 * Looks up the owner of a repo-relative file at `root`: the package of its nearest `package.json` up to the root, or
 * the root itself when none is found. A missing or invalid manifest makes the owner private.
 */
export function ownerLookup(root: string): (file: string) => Owner {
  return (file) => {
    let dir = path.dirname(file);
    while (dir !== "." && !fs.existsSync(path.join(root, dir, "package.json"))) dir = path.dirname(dir);
    return { dir, public: isPublic(path.join(root, dir, "package.json")) };
  };
}

/**
 * Whether red-proof applies to `change`: always with `tdd`, else when a changed source file belongs to a public
 * package, or, with no source file changed, a changed test file does.
 */
export function proofApplies(change: readonly NameStatus[], tdd: boolean, owners: (file: string) => Owner): boolean {
  if (tdd) return true;
  const sources = change.filter((entry) => isSource(entry.path));
  const files = sources.length > 0 ? sources : change.filter((entry) => isTestFile(entry.path));
  return files.some((entry) => owners(entry.path).public);
}
