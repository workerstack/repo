/** The one record guard for parsed JSON, YAML and TOML. */

/** A parsed object whose values are not yet checked. */
export type JsonObject = Record<string, unknown>;

/** True for a non-null object that is not an array and not a Date, which smol-toml returns for a datetime. */
export function isRecord(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value) && !(value instanceof Date);
}
