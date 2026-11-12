/** The table guard for values smol-toml parses. */
import type { TomlTable, TomlValue } from "smol-toml";

/**
 * True for a TOML table, false for an array, a datetime (smol-toml's TomlDate extends Date), a primitive and a missing
 * value.
 */
export function isTomlTable(value: TomlValue | undefined): value is TomlTable {
  return typeof value === "object" && !Array.isArray(value) && !(value instanceof Date);
}
