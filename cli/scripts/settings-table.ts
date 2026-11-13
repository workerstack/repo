/** The values JSON and TOML config files parse to, read as one kind, and the guard that reads a value as a table. */
import type { TomlTable, TomlValue } from "smol-toml";

import type { Json } from "../json.ts";

/** A value a JSON or TOML config holds: parsed JSON, a TOML value (a datetime included) or a table built from them. */
export type SettingsValue = Json | TomlValue | SettingsTable;

/** A parsed config file or one of its tables, keyed by setting name. */
export type SettingsTable = { [key: string]: SettingsValue };

/** True for a table: an object that is not an array or a TOML datetime (smol-toml's TomlDate extends Date). */
export function isSettingsTable(value: SettingsValue | undefined): value is SettingsTable {
  return typeof value === "object" && value !== null && !Array.isArray(value) && !(value instanceof Date);
}

/** True for a non-empty array whose every item is a table: a list of rules, as opposed to a list of plain values. */
export function isTableArray(value: SettingsValue | undefined): value is TomlTable[] {
  return Array.isArray(value) && value.length > 0 && value.every((item) => isSettingsTable(item));
}
