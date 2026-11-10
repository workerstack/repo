/** The `link` section of workerstack.config.ts: package name to the checkout `repo link` packs it from. */
import { z } from "zod";
import { LINK_OBJECT_ERROR, LINK_PATH_ERROR } from "./link.constants.ts";

/** The schema of `link`: a map from package name to a path relative to the repo root. */
export function linkSchema(): z.ZodRecord<z.ZodString, z.ZodString> {
  return z.record(z.string(), z.string({ error: LINK_PATH_ERROR }), { error: LINK_OBJECT_ERROR });
}
