/** A deep merge of settings objects: source keys win, nested objects merge, and skipped key paths stay out. */
import { shouldSkip } from "./global-settings-files.ts";
import { isSettingsTable, type SettingsTable, type SettingsValue } from "./settings-table.ts";

/** The skip pattern and the key path down to the objects being merged. */
type MergeAt = { skipRe: RegExp | null | undefined; keyPath: string[] };

function mergeAt(dest: SettingsValue, source: SettingsValue, at: MergeAt): SettingsTable {
  const out: SettingsTable = isSettingsTable(dest) ? { ...dest } : {};

  if (!isSettingsTable(source)) return out;

  for (const [k, v] of Object.entries(source)) {
    const keyPath = [...at.keyPath, k];

    if (keyPath.some((seg) => shouldSkip(seg, at.skipRe))) continue;
    const prev = out[k];
    out[k] = isSettingsTable(v) && isSettingsTable(prev) ? mergeAt(prev, v, { keyPath, skipRe: at.skipRe }) : v;
  }

  return out;
}

export function deepMerge(
  dest: SettingsValue,
  source: SettingsValue,
  skipRe: RegExp | null | undefined,
): SettingsTable {
  return mergeAt(dest, source, { keyPath: [], skipRe });
}
