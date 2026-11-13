/** The `ci` section of repo.config.ts: named commands `repo ci` runs after its own gates. */
import { z } from "zod";

import {
  BUILT_IN_LABELS,
  builtIn,
  CI_ARGV_ERROR,
  CI_CHECKS_ERROR,
  CI_OBJECT_ERROR,
  KEBAB_NAME,
  notKebab,
} from "./ci-schema.constants.ts";
import type { ResolvedConfig } from "./config-resolved.types.ts";

type CiSchema = z.ZodObject<
  { checks: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodReadonly<z.ZodArray<z.ZodString>>>> },
  z.core.$strict
>;

/** The schema of `ci`: `checks` maps a kebab-case name, not a built-in gate label, to an argv. */
export function ciSchema(): CiSchema {
  const word = z.string({ error: CI_ARGV_ERROR }).min(1, { error: CI_ARGV_ERROR });
  const argv = z.array(word, { error: CI_ARGV_ERROR }).min(1, { error: CI_ARGV_ERROR }).readonly();

  const checks = z.record(z.string(), argv, { error: CI_CHECKS_ERROR }).superRefine((map, ctx) => {
    for (const name of Object.keys(map)) {
      if (BUILT_IN_LABELS.includes(name)) ctx.addIssue({ code: "custom", message: builtIn(name) });
      else if (!KEBAB_NAME.test(name)) ctx.addIssue({ code: "custom", message: notKebab(name) });
    }
  });

  return z.strictObject({ checks: checks.optional() }, { error: CI_OBJECT_ERROR });
}

/** The resolved `ci` of a parsed config: its checks, none when omitted. */
export function ciOf(parsed: { ci?: z.output<CiSchema> | undefined }): Pick<ResolvedConfig, "ci"> {
  return { ci: { checks: parsed.ci?.checks ?? {} } };
}
