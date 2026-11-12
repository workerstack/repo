/** The one record guard for parsed JSON, YAML and TOML, and the schema-first JSON readers. */
import { z } from "zod";

/** A parsed object whose values are not yet checked. */
export type JsonObject = Record<string, unknown>;

/** True for a non-null object that is not an array and not a Date, which smol-toml returns for a datetime. */
export function isRecord(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value) && !(value instanceof Date);
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
