/** The parsed JSON and YAML value type, its guards, and the schema-first JSON readers. */
import { z } from "zod";

/** A value JSON.parse or a YAML parse returns: a primitive, an array of Json or an object of Json. */
export type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

/**
 * A value a JSON writer takes: Json with readonly arrays and objects, and an object value may be undefined, which
 * JSON.stringify drops.
 */
export type JsonInput =
  | string
  | number
  | boolean
  | null
  | readonly JsonInput[]
  | { readonly [key: string]: JsonInput | undefined };

/** A parsed JSON or YAML object. */
export type JsonObject = { [key: string]: Json };

/** True for a parsed object, false for an array, a primitive, null and a missing value. */
export function isRecord(value: Json | undefined): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** True for a parsed string, false for any other parsed value and a missing one. */
export function isString(value: Json | undefined): value is string {
  return typeof value === "string";
}

/** True for a parsed number, false for any other parsed value and a missing one. */
export function isNumber(value: Json | undefined): value is number {
  return typeof value === "number";
}

/** True for a parsed boolean, false for any other parsed value and a missing one. */
export function isBoolean(value: Json | undefined): value is boolean {
  return typeof value === "boolean";
}

/** True for a parsed array whose every entry is a string, the empty array included; false for anything else. */
export function isStringList(value: Json | undefined): value is string[] {
  return Array.isArray(value) && value.every(isString);
}

/**
 * `text` parsed as JSON and read through `schema`. Rethrows JSON.parse's SyntaxError for text that is not JSON, and
 * throws an Error holding zod's prettified issues, each naming its key, for a shape `schema` refuses.
 */
export function readJson<S extends z.ZodType>(schema: S, text: string): z.output<S> {
  const parsed = schema.safeParse(JSON.parse(text));

  if (!parsed.success) throw new Error(z.prettifyError(parsed.error));

  return parsed.data;
}

/** `text` parsed as JSON and read through `schema`, or undefined when it is not JSON or `schema` refuses its shape. */
export function tryJson<S extends z.ZodType>(schema: S, text: string): z.output<S> | undefined {
  let value: unknown;

  try {
    value = JSON.parse(text);
  } catch {
    return undefined;
  }

  const parsed = schema.safeParse(value);

  return parsed.success ? parsed.data : undefined;
}
