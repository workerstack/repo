/** The `clean` section of workerstack.config.ts: extra dir names `repo clean --build` removes. */
import { z } from "zod";

import { CLEAN_LIST_ERROR, CLEAN_NAME_ERROR, CLEAN_OBJECT_ERROR, PATH_SEPARATOR } from "./clean-schema.constants.ts";

/** The schema of `clean`: `build` lists dir names, not paths. */
export function cleanSchema(): z.ZodObject<
  { build: z.ZodOptional<z.ZodReadonly<z.ZodArray<z.ZodString>>> },
  z.core.$strict
> {
  const name = z
    .string({ error: CLEAN_NAME_ERROR })
    .refine((value) => value !== "" && !PATH_SEPARATOR.test(value), { error: CLEAN_NAME_ERROR });
  return z.strictObject(
    { build: z.array(name, { error: CLEAN_LIST_ERROR }).readonly().optional() },
    { error: CLEAN_OBJECT_ERROR },
  );
}
