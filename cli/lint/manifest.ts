import fs from "node:fs";
import path from "node:path";

/**
 * What a package.json declares, parsed from untrusted JSON: a field of the wrong shape counts as absent. `bins` are
 * the `bin` paths as written, relative to the manifest's dir.
 */
export type Manifest = { file: string; name: string | null; declared: string[]; bins: string[] };

const DEPENDENCY_MAPS = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"];

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** The nearest package.json at or above `start`, or null when none is. */
export function nearestManifest(start: string): string | null {
  let dir = start;
  while (!fs.existsSync(path.join(dir, "package.json"))) {
    if (path.dirname(dir) === dir) return null;
    dir = path.dirname(dir);
  }
  return path.join(dir, "package.json");
}

/** A manifest's bin scripts: `bin` as one path or a map of them; anything else names none. */
export function binsOf(bin: unknown): string[] {
  const all = isRecord(bin) ? Object.values(bin) : [bin];
  return all.filter((file) => typeof file === "string");
}

/** The manifest at `file`, or null when it cannot be read as a JSON object. */
export function readManifest(file: string): Manifest | null {
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
  if (!isRecord(raw)) return null;
  const name = typeof raw.name === "string" ? raw.name : null;
  const declared = DEPENDENCY_MAPS.flatMap((key) => {
    const map = raw[key];
    return isRecord(map) ? Object.keys(map) : [];
  });
  return { file, name, declared, bins: binsOf(raw.bin) };
}
