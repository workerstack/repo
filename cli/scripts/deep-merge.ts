import { isRecord, type JsonObject } from "../json.ts";
/** A deep merge of settings objects: source keys win, nested objects merge, and skipped key paths stay out. */
import { shouldSkip } from "./global-settings-files.ts";

/** The skip pattern and the key path down to the objects being merged. */
type MergeAt = { skipRe: RegExp | null | undefined; keyPath: string[] };

function mergeAt(dest: unknown, source: unknown, at: MergeAt): JsonObject {
  const out: JsonObject = isRecord(dest) ? { ...dest } : {};

  if (!isRecord(source)) return out;

  for (const [k, v] of Object.entries(source)) {
    const keyPath = [...at.keyPath, k];

    if (keyPath.some((seg) => shouldSkip(seg, at.skipRe))) continue;
    const prev = out[k];
    out[k] = isRecord(v) && isRecord(prev) ? mergeAt(prev, v, { keyPath, skipRe: at.skipRe }) : v;
  }

  return out;
}

export function deepMerge(dest: unknown, source: unknown, skipRe: RegExp | null | undefined): JsonObject {
  return mergeAt(dest, source, { keyPath: [], skipRe });
}
