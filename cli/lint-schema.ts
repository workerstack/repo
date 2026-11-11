/** The `lint` section of workerstack.config.ts: the sanctioned rule skips. */
import { z } from "zod";

import { isReason } from "./lint/is-reason.ts";

const REASON_ERROR = "say why the rules are off, in three words or more";
const SKIP_LIST = "must be a list of { files, rules, reason } entries";

/** One sanctioned exception: oxlint rule keys turned off for the files the globs match, and why. */
function skipSchema(): SkipSchema {
  const list = (error: string, empty: string): ListSchema =>
    z.array(z.string({ error }), { error }).min(1, { error: empty }).readonly();
  return z.strictObject(
    {
      files: list("must be a list of file globs", "list at least one file glob"),
      reason: z.string({ error: REASON_ERROR }).refine(isReason, { error: REASON_ERROR }),
      rules: list("must be a list of rule names", 'list at least one rule, like "repo/no-module-state"'),
    },
    { error: 'must be an object like { files: ["src/a.ts"], rules: ["repo/no-module-state"], reason: "why" }' },
  );
}

type ListSchema = z.ZodReadonly<z.ZodArray<z.ZodString>>;
type SkipSchema = z.ZodObject<{ files: ListSchema; rules: ListSchema; reason: z.ZodString }, z.core.$strict>;
type LintSchema = z.ZodObject<{ skip: z.ZodOptional<z.ZodReadonly<z.ZodArray<SkipSchema>>> }, z.core.$strict>;

/** `lint`: the skips, built when the config schema is. */
export function lintSchema(): LintSchema {
  return z.strictObject(
    { skip: z.array(skipSchema(), { error: SKIP_LIST }).readonly().optional() },
    { error: "must be an object like { skip: [{ files, rules, reason }] }" },
  );
}
