/** The `commit` section of repo.config.ts: how big a commit may be before its message must say why. */
import { z } from "zod";

/** How many changed lines a commit may have before its message must say why. */
export const DEFAULT_MAX_CHANGED_LINES = 1000;

export function commitSchema(): z.ZodObject<{ maxChangedLines: z.ZodOptional<z.ZodNumber> }, z.core.$strict> {
  return z.strictObject(
    {
      maxChangedLines: z
        .number({ error: "must be a whole number of lines above 0" })
        .int({ error: "must be a whole number of lines above 0" })
        .positive({ error: "must be a whole number of lines above 0" })
        .optional(),
    },
    { error: `must be an object like { maxChangedLines: ${DEFAULT_MAX_CHANGED_LINES} }` },
  );
}
