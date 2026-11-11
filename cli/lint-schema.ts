/** The `lint` section of workerstack.config.ts: the sanctioned rule skips and the `repo/boundaries` package tags. */
import { z } from "zod";

import type { ResolvedLint } from "./config-resolved.types.ts";
import { isReason } from "./lint/is-reason.ts";

const REASON_ERROR = "say why the rules are off, in three words or more";
const SKIP_LIST = "must be a list of { files, rules, reason } entries";
const TAG_NAME = 'must be a tag name like "ui"';

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

/**
 * `lint.boundaries`: each package name's one tag, and per tag the tags it may import. Whether the names are workspace
 * packages and the tags agree is sync's check, which reads the workspace.
 */
function boundariesSchema(): BoundariesSchema {
  const tag = z.string({ error: TAG_NAME }).min(1, { error: TAG_NAME });
  return z.strictObject(
    {
      allow: z
        .record(z.string(), z.array(tag, { error: "must be a list of tag names" }).readonly(), {
          error: 'must be an object like { app: ["ui"], ui: [] }',
        })
        .readonly(),
      tags: z.record(z.string(), tag, { error: 'must be an object like { "@app/web": "app" }' }).readonly(),
    },
    { error: 'must be an object like { tags: { "@app/web": "app" }, allow: { app: [] } }' },
  );
}

type ListSchema = z.ZodReadonly<z.ZodArray<z.ZodString>>;
type SkipSchema = z.ZodObject<{ files: ListSchema; rules: ListSchema; reason: z.ZodString }, z.core.$strict>;
type BoundariesSchema = z.ZodObject<
  {
    allow: z.ZodReadonly<z.ZodRecord<z.ZodString, ListSchema>>;
    tags: z.ZodReadonly<z.ZodRecord<z.ZodString, z.ZodString>>;
  },
  z.core.$strict
>;
type LintSchema = z.ZodObject<
  {
    boundaries: z.ZodOptional<BoundariesSchema>;
    skip: z.ZodOptional<z.ZodReadonly<z.ZodArray<SkipSchema>>>;
  },
  z.core.$strict
>;

/** `lint`: the skips and the package tags, built when the config schema is. */
export function lintSchema(): LintSchema {
  return z.strictObject(
    {
      boundaries: boundariesSchema().optional(),
      skip: z.array(skipSchema(), { error: SKIP_LIST }).readonly().optional(),
    },
    { error: "must be an object like { skip: [{ files, rules, reason }] }" },
  );
}

/** A parsed `lint` with no skips when it lists none, and `boundaries` only when it sets them. */
export function lintOf(lint: z.output<LintSchema> | undefined): ResolvedLint {
  const skip = lint?.skip ?? [];
  return lint?.boundaries === undefined ? { skip } : { boundaries: lint.boundaries, skip };
}
