import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { z } from "zod";

import { readJson } from "./json.ts";
import {
  CHECKOUT_TOP,
  DEPENDENTS_DIR,
  DEPENDENTS_VERSION,
  HASH_LENGTH,
  JSON_INDENT,
  badDependent,
} from "./link.constants.ts";
import { canonicalPath } from "./scripts/workspace-root.ts";
import { errorMessage } from "./sync-errors.ts";

/** One package of a source checkout that a consumer root links. */
type DependentPackage = { name: string; dir: string };

/** One consumer root and the packages of the source checkout it links. */
type Dependent = { root: string; packages: DependentPackage[] };

function dependentSchema(): z.ZodType<{ packages: DependentPackage[]; root: string; version: number }> {
  const pkg = z.object({ dir: z.string(), name: z.string() });

  return z.object({ packages: z.array(pkg), root: z.string(), version: z.literal(DEPENDENTS_VERSION) });
}

function dependentsDir(checkout: string): string {
  return path.join(checkout, DEPENDENTS_DIR);
}

function dependentFile(checkout: string, root: string): string {
  const hash = createHash("sha256")
    .update(canonicalPath(path.resolve(root)))
    .digest("hex")
    .slice(0, HASH_LENGTH);

  return path.join(dependentsDir(checkout), `${hash}.json`);
}

/** The file's content; throws for a file that is absent or does not parse. */
function parseFile(file: string): Dependent {
  const { packages, root } = readJson(dependentSchema(), fs.readFileSync(file, "utf8"));

  return { packages, root };
}

/** The file's content, or null when it is absent or does not parse (a new write then replaces it). */
function readFile(file: string): Dependent | null {
  try {
    return parseFile(file);
  } catch {
    return null;
  }
}

/** Writes by rename, so a reader never sees half a file and two commands never share a temp file. */
function writeFile(file: string, value: Dependent): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  const text = JSON.stringify({ ...value, version: DEPENDENTS_VERSION }, null, JSON_INDENT);
  fs.writeFileSync(temp, `${text}\n`);
  fs.renameSync(temp, file);
}

/** Records that `root` links `pkg` of the source `checkout`; a package already recorded is replaced. */
export function registerDependent(checkout: string, root: string, pkg: DependentPackage): void {
  const file = dependentFile(checkout, root);
  const others = (readFile(file)?.packages ?? []).filter((one) => one.name !== pkg.name);
  const packages = [...others, pkg].toSorted((a, b) => a.name.localeCompare(b.name));
  writeFile(file, { packages, root: canonicalPath(path.resolve(root)) });
}

/** Drops `name` from `root`'s record in the source `checkout`; the file goes with its last package. */
export function unregisterDependent(checkout: string, root: string, name: string): void {
  const file = dependentFile(checkout, root);
  const found = readFile(file);

  if (found === null) return;
  const packages = found.packages.filter((one) => one.name !== name);

  if (packages.length === 0) fs.rmSync(file, { force: true });
  else writeFile(file, { packages, root: found.root });
}

/** Every consumer root recorded in `checkout`; a file that does not parse is skipped with a `warn` line. */
export function readDependents(checkout: string, warn: (line: string) => void): Dependent[] {
  const dir = dependentsDir(checkout);

  if (!fs.existsSync(dir)) return [];

  const files = fs
    .readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .toSorted();

  return files.flatMap((name) => {
    const file = path.join(dir, name);

    try {
      return [parseFile(file)];
    } catch (error) {
      warn(badDependent(file, errorMessage(error)));

      return [];
    }
  });
}

/** The checkout holding `dir`: the nearest dir at or above it with a `.git` entry (dir or file); else null. */
export function checkoutOf(dir: string): string | null {
  if (fs.existsSync(path.join(dir, CHECKOUT_TOP))) return dir;
  const up = path.dirname(dir);

  return up === dir ? null : checkoutOf(up);
}
