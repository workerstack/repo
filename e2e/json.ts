/** Guards that narrow parsed JSON to the shape a test reads. */

import { isRecord } from "../cli/json.ts";

export function isStringMap(v: unknown): v is Record<string, string> {
  return isRecord(v) && Object.values(v).every((x) => typeof x === "string");
}

export function isStringList(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === "string");
}
