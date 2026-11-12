import fs from "node:fs";
import path from "node:path";

import { z } from "zod";

import { isPublic } from "../docs-exports.ts";
import { MANIFEST_FILE, VERSION_LINE } from "./release.constants.ts";

/** The fields of the root package.json a release reads. */
export type Manifest = { name: string; version: string; private: boolean };

function schema() {
  return z.object({ name: z.string(), private: z.boolean().optional(), version: z.string() });
}

/** The manifest in `text`; null when it is not JSON or lacks a name or version. */
export function parseManifest(text: string): Manifest | null {
  try {
    const parsed = schema().safeParse(JSON.parse(text));

    return parsed.success ? { ...parsed.data, private: parsed.data.private === true } : null;
  } catch {
    return null;
  }
}

/** The manifest at `root`; null when it is missing, not JSON or lacks a name or version. */
export function readManifest(root: string): Manifest | null {
  try {
    return parseManifest(fs.readFileSync(path.join(root, MANIFEST_FILE), "utf8"));
  } catch {
    return null;
  }
}

/** Whether the root package.json names a package and says `"private": false`, as `repo check` reads a public one. */
export function isPublicPackage(root: string): boolean {
  try {
    const parsed = schema().safeParse(JSON.parse(fs.readFileSync(path.join(root, MANIFEST_FILE), "utf8")));

    return parsed.success && isPublic(parsed.data);
  } catch {
    return false;
  }
}

/** Rewrites the `version` line of the manifest at `root`, and nothing else in the file. */
export function writeVersion(root: string, version: string): void {
  const file = path.join(root, MANIFEST_FILE);
  fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace(VERSION_LINE, `$1"${version}"`));
}
