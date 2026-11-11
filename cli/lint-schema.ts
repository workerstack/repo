/**
 * The `lint` section of workerstack.config.ts: the sanctioned rule skips, the `repo/boundaries` package tags and the
 * Tailwind entry sheet.
 */
import path from "node:path";

import { z } from "zod";

import type { ResolvedLint } from "./config-resolved.types.ts";
import { CSS_SOURCE } from "./css/stylelint.constants.ts";
import { isReason } from "./lint/is-reason.ts";

const REASON_ERROR = "say why the rules are off, in three words or more";
const SKIP_LIST = "must be a list of { files, rules, reason } entries";
const TAG_NAME = 'must be a tag name like "ui"';
const ENTRY_POINT = "must be a repo-relative path to a .css file";
const PARENT = "..";
/** A path separator on any platform. */
const SEPARATOR = /[\\/]/;

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

/** Whether `rel` names a `.css` file inside the repo: not absolute on any platform, and never climbing out. */
function isRepoCss(rel: string): boolean {
  const climbs = rel.split(SEPARATOR).includes(PARENT);
  return CSS_SOURCE.test(rel) && !climbs && !path.posix.isAbsolute(rel) && !path.win32.isAbsolute(rel);
}

/** `lint.tailwind`: the entry sheet; whether it is a file importing tailwindcss is sync's check, which reads it. */
function tailwindSchema(): TailwindSchema {
  return z.strictObject(
    { entryPoint: z.string({ error: ENTRY_POINT }).refine(isRepoCss, { error: ENTRY_POINT }) },
    { error: 'must be an object like { entryPoint: "src/app.css" }' },
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
type TailwindSchema = z.ZodObject<{ entryPoint: z.ZodString }, z.core.$strict>;
type LintSchema = z.ZodObject<
  {
    boundaries: z.ZodOptional<BoundariesSchema>;
    skip: z.ZodOptional<z.ZodReadonly<z.ZodArray<SkipSchema>>>;
    tailwind: z.ZodOptional<TailwindSchema>;
  },
  z.core.$strict
>;

/** `lint`: the skips, the package tags and the Tailwind entry, built when the config schema is. */
export function lintSchema(): LintSchema {
  return z.strictObject(
    {
      boundaries: boundariesSchema().optional(),
      skip: z.array(skipSchema(), { error: SKIP_LIST }).readonly().optional(),
      tailwind: tailwindSchema().optional(),
    },
    { error: "must be an object like { skip: [{ files, rules, reason }] }" },
  );
}

/** A parsed `lint` with no skips when it lists none, and `boundaries` and `tailwind` only when it sets them. */
export function lintOf(lint: z.output<LintSchema> | undefined): ResolvedLint {
  return {
    ...(lint?.boundaries === undefined ? {} : { boundaries: lint.boundaries }),
    skip: lint?.skip ?? [],
    ...(lint?.tailwind === undefined ? {} : { tailwind: lint.tailwind }),
  };
}
