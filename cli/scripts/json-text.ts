/** A parsed JSON value as text for a printed line. */
import { isRecord, type Json } from "../json.ts";

/**
 * `value` as text: a primitive and a missing value as String spells them (`undefined` included), an object or array as
 * its JSON, so no line prints `[object Object]`.
 */
export function jsonText(value: Json | undefined): string {
  return isRecord(value) || Array.isArray(value) ? JSON.stringify(value) : String(value);
}
