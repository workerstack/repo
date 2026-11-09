import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { MANIFEST_FILE, VERSION_LINE } from "./release.constants.ts";

/** The fields of the root package.json a release reads. */
export type Manifest = { name: string; version: string; private: boolean };

const schema = () => z.object({ name: z.string(), version: z.string(), private: z.boolean().optional() });

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

/** Rewrites the `version` line of the manifest at `root`, and nothing else in the file. */
export function writeVersion(root: string, version: string): void {
  const file = path.join(root, MANIFEST_FILE);
  fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace(VERSION_LINE, `$1"${version}"`));
}
