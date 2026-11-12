/** The bun version floor and the dotted-version compare the `bun` row checks against it. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { z } from "zod";

import { tryJson } from "../json.ts";
import { packageJsonSchema } from "../package-json.ts";
import { BUN_MIN_FALLBACK, VERSION_PARTS } from "./doctor.constants.ts";

const VERSION_RE = /\d+(?:\.\d+){0,2}/;
const DOTTED_RE = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?/;

function enginesSchema() {
  return packageJsonSchema.pick({}).extend({ engines: z.looseObject({ bun: z.string().optional() }).optional() });
}

/** The package.json two levels above this script. */
function besidePackageJson(): string {
  return path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "package.json");
}

/** The `engines.bun` floor from the package.json two levels above this script, as `1.4.4`. */
export function bunMinimum(file: string = besidePackageJson()): string {
  try {
    const range = tryJson(enginesSchema(), fs.readFileSync(file, "utf8"))?.engines?.bun;

    return VERSION_RE.exec(String(range))?.[0] ?? BUN_MIN_FALLBACK;
  } catch {
    return BUN_MIN_FALLBACK;
  }
}

/** True when dotted version `have` (an optional leading `v`) is at least `min`; an unreadable `have` is not. */
export function versionAtLeast(have: string, min: string): boolean {
  const a = DOTTED_RE.exec(have);

  if (a === null) return false;
  const b = min.split(".").map(Number);

  for (let i = 0; i < VERSION_PARTS; i++) {
    const x = Number(a[i + 1] ?? 0);
    const y = b[i] ?? 0;

    if (x !== y) return x > y;
  }

  return true;
}
