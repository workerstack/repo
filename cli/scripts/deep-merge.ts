/** A deep merge of settings objects: source keys win, nested objects merge, and skipped key paths stay out. */
import { isDeepStrictEqual } from "node:util";

import type { TomlTable } from "smol-toml";

import { shouldSkip } from "./global-settings-files.ts";
import { isSettingsTable, isTableArray, type SettingsTable, type SettingsValue } from "./settings-table.ts";

/** The skip pattern and the key path down to the objects being merged. */
type MergeAt = { skipRe: RegExp | null | undefined; keyPath: string[] };

/** Source tables the dest lacks, ahead of the dest's own, so the dest's rules still come last and win. */
function mergeTables(dest: TomlTable[], source: TomlTable[]): TomlTable[] {
  return [...source.filter((s) => !dest.some((d) => isDeepStrictEqual(d, s))), ...dest];
}

function mergeValue(prev: SettingsValue | undefined, v: SettingsValue, at: MergeAt): SettingsValue {
  if (isSettingsTable(v) && isSettingsTable(prev)) return mergeAt(prev, v, at);

  if (isTableArray(v) && isTableArray(prev)) return mergeTables(prev, v);

  return v;
}

function mergeAt(dest: SettingsValue, source: SettingsValue, at: MergeAt): SettingsTable {
  const out: SettingsTable = isSettingsTable(dest) ? { ...dest } : {};

  if (!isSettingsTable(source)) return out;

  for (const [k, v] of Object.entries(source)) {
    const keyPath = [...at.keyPath, k];

    if (keyPath.some((seg) => shouldSkip(seg, at.skipRe))) continue;
    out[k] = mergeValue(out[k], v, { keyPath, skipRe: at.skipRe });
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
