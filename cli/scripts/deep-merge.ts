/** A deep merge of settings objects: source keys win, nested objects merge, and skipped key paths stay out. */
import { isPlainObject, shouldSkip } from "./global-settings-files.ts";
import type { JsonObject } from "./sync-global-settings.types.ts";

/** The skip pattern and the key path down to the objects being merged. */
type MergeAt = { skipRe: RegExp | null | undefined; keyPath: string[] };

function mergeAt(dest: unknown, source: unknown, at: MergeAt): JsonObject {
  const out: JsonObject = isPlainObject(dest) ? { ...dest } : {};

  if (!isPlainObject(source)) return out;

  for (const [k, v] of Object.entries(source)) {
    const keyPath = [...at.keyPath, k];

    if (keyPath.some((seg) => shouldSkip(seg, at.skipRe))) continue;
    const prev = out[k];
    out[k] = isPlainObject(v) && isPlainObject(prev) ? mergeAt(prev, v, { keyPath, skipRe: at.skipRe }) : v;
  }

  return out;
}

export function deepMerge(dest: unknown, source: unknown, skipRe: RegExp | null | undefined): JsonObject {
  return mergeAt(dest, source, { keyPath: [], skipRe });
}
