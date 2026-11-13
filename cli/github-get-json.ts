import type { z } from "zod";

import type { Gh, GhFailure } from "./github-gh.ts";
import { tryJson } from "./json.ts";

/** A parsed answer, or why there is none. */
export type Got<T> = { ok: true; value: T } | GhFailure;

/** The failure for an answer of another shape: never read as "fine". */
export const UNEXPECTED: GhFailure = { kind: "other", message: "GitHub answered something unexpected", ok: false };

/** GETs `path` and parses its JSON body with `schema`; an answer of another shape is a failure. */
export async function getJson<T>(gh: Gh, path: string, schema: () => z.ZodType<T>): Promise<Got<T>> {
  const result = await gh({ method: "GET", path });

  if (!result.ok) return result;
  const value = tryJson(schema(), result.stdout);

  return value === undefined ? UNEXPECTED : { ok: true, value };
}
