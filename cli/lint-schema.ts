/**
 * The `lint` section of repo.config.ts: the sanctioned rule skips, the `repo/boundaries` package tags, the Tailwind
 * entry sheet and a consumer's own oxlint plugins with the rules it turns on.
 */
import path from "node:path";

import { z } from "zod";

import type { ResolvedLint } from "./config-resolved.types.ts";
import { CSS_SOURCE } from "./css/stylelint.constants.ts";
import type { Json } from "./json.ts";
import { isReason } from "./lint/is-reason.ts";

const REASON_ERROR = "say why the rules are off, in three words or more";
const SKIP_LIST = "must be a list of { files, rules, reason } entries";
const TAG_NAME = 'must be a tag name like "ui"';
const ENTRY_POINT = "must be a repo-relative path to a .css file";
const PARENT = "..";
const PLUGIN_NAME = 'must be a lowercase kebab-case name, like "app"';
const PLUGIN_PATH = 'must be a repo-relative path to a .js, .mjs or .ts file, like "lint/app.js"';
const PLUGIN_MAP = 'must be an object like { app: "lint/app.js" }';
const RULE_LIST = "must be a list of { files, rules } entries";
const RULE_SETTING = 'must be "error" or ["error", options]; lint.skip turns rules off';
const RULE_MAP = 'must be an object like { "app/no-x": "error" }';

/**
 * The plugin names a consumer cannot take: oxlint's native plugins and their aliases, and the prefixes `repo` itself
 * registers or routes to another tool.
 */
const STOCK_PLUGINS = [
  "eslint",
  "react",
  "unicorn",
  "typescript",
  "oxc",
  "import",
  "jsdoc",
  "jest",
  "vitest",
  "jsx-a11y",
  "nextjs",
  "react-perf",
  "promise",
  "node",
  "vue",
  "react-hooks",
  "import-x",
  "jsx-a11y-x",
  "repo",
  "tailwindcss",
  "stylelint",
  "clippy",
  "rust",
] as const;

/** A plugin name a consumer plugin cannot take. */
export type StockPlugin = (typeof STOCK_PLUGINS)[number];

const STOCK: ReadonlySet<string> = /* @__PURE__ */ new Set(STOCK_PLUGINS);

/** A plugin name: lowercase words joined by single hyphens, starting with a letter. */
const KEBAB = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

/** A plugin file: JavaScript or TypeScript. */
const PLUGIN_FILE = /\.(?:js|mjs|ts)$/;

/** A rule key from its first slash on, which leaves the plugin name. */
const FROM_SLASH = /\/.*$/;

/** A leading `./`, which a stored path drops. */
const DOT_SLASH = /^(?:\.\/)+/;

/** A path separator on any platform. */
const SEPARATOR = /[\\/]/;

function list(error: string, empty: string): ListSchema {
  return z.array(z.string({ error }), { error }).min(1, { error: empty }).readonly();
}

/** One sanctioned exception: oxlint rule keys turned off for the files the globs match, and why. */
function skipSchema(): SkipSchema {
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

/** Whether `rel` names a `.js`, `.mjs` or `.ts` file inside the repo, as `isRepoCss` does for a sheet. */
function isRepoPlugin(rel: string): boolean {
  const climbs = rel.split(SEPARATOR).includes(PARENT);

  return PLUGIN_FILE.test(rel) && !climbs && !path.posix.isAbsolute(rel) && !path.win32.isAbsolute(rel);
}

/** `lint.plugins`: plugin name to its file; each name is checked as a key, so the issue lands on it. */
function pluginsSchema(): PluginsSchema {
  const file = z.string({ error: PLUGIN_PATH }).refine(isRepoPlugin, { error: PLUGIN_PATH });

  return z.record(z.string(), file, { error: PLUGIN_MAP }).superRefine((plugins, ctx) => {
    for (const name of Object.keys(plugins)) {
      if (STOCK.has(name))
        ctx.addIssue({ code: "custom", message: 'is a stock plugin name; pick another, like "app"', path: [name] });
      else if (!KEBAB.test(name)) ctx.addIssue({ code: "custom", message: PLUGIN_NAME, path: [name] });
    }
  });
}

/** One rule's setting: on at error severity, with options after it when it takes some. */
function ruleSetting(): RuleSettingSchema {
  return z.union([z.literal("error"), z.tuple([z.literal("error")], z.json()).readonly()], { error: RULE_SETTING });
}

/** `lint.rules` entry: rules a registered plugin owns, turned on for the files the globs match, or everywhere. */
function ruleEntrySchema(): RuleEntrySchema {
  return z.strictObject(
    {
      files: list("must be a list of file globs", "list at least one file glob").optional(),
      rules: z
        .record(z.string(), ruleSetting(), { error: RULE_MAP })
        .refine((rules) => Object.keys(rules).length > 0, { error: 'list at least one rule like "app/no-x"' }),
    },
    { error: 'must be an object like { files: ["src/**"], rules: { "app/no-x": "error" } }' },
  );
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

type PluginsSchema = z.ZodRecord<z.ZodString, z.ZodString>;

type RuleSettingSchema = z.ZodUnion<
  readonly [z.ZodLiteral<"error">, z.ZodReadonly<z.ZodTuple<[z.ZodLiteral<"error">], z.ZodType<Json>>>]
>;

type RuleEntrySchema = z.ZodObject<
  { files: z.ZodOptional<ListSchema>; rules: z.ZodRecord<z.ZodString, RuleSettingSchema> },
  z.core.$strict
>;

type TailwindSchema = z.ZodObject<{ entryPoint: z.ZodString }, z.core.$strict>;

type LintSchema = z.ZodObject<
  {
    boundaries: z.ZodOptional<BoundariesSchema>;
    plugins: z.ZodOptional<PluginsSchema>;
    rules: z.ZodOptional<z.ZodReadonly<z.ZodArray<RuleEntrySchema>>>;
    skip: z.ZodOptional<z.ZodReadonly<z.ZodArray<SkipSchema>>>;
    tailwind: z.ZodOptional<TailwindSchema>;
  },
  z.core.$strict
>;

/** `lint`: the skips, package tags, Tailwind entry, consumer plugins and their rules, built with the config schema. */
export function lintSchema(): LintSchema {
  const lint = z.strictObject(
    {
      boundaries: boundariesSchema().optional(),
      plugins: pluginsSchema().optional(),
      rules: z.array(ruleEntrySchema(), { error: RULE_LIST }).readonly().optional(),
      skip: z.array(skipSchema(), { error: SKIP_LIST }).readonly().optional(),
      tailwind: tailwindSchema().optional(),
    },
    { error: "must be an object like { skip: [{ files, rules, reason }] }" },
  );

  return lint.superRefine((value, ctx) => {
    const plugins = new Set(Object.keys(value.plugins ?? {}));

    for (const [index, entry] of (value.rules ?? []).entries()) {
      for (const key of Object.keys(entry.rules)) {
        if (!plugins.has(key.replace(FROM_SLASH, ""))) {
          ctx.addIssue({
            code: "custom",
            message: `${JSON.stringify(key)} names no plugin in lint.plugins`,
            path: ["rules", index, "rules"],
          });
        }
      }
    }
  });
}

/** Each plugin's path without its leading `./`. */
function repoPaths(plugins: Readonly<Record<string, string>> | undefined): Record<string, string> {
  return Object.fromEntries(Object.entries(plugins ?? {}).map(([name, file]) => [name, file.replace(DOT_SLASH, "")]));
}

/**
 * A parsed `lint` with no skips, plugins or rules when it lists none, and `boundaries` and `tailwind` only when it
 * sets them.
 */
export function lintOf(lint: z.output<LintSchema> | undefined): ResolvedLint {
  return {
    ...(lint?.boundaries === undefined ? {} : { boundaries: lint.boundaries }),
    plugins: repoPaths(lint?.plugins),
    rules: lint?.rules ?? [],
    skip: lint?.skip ?? [],
    ...(lint?.tailwind === undefined ? {} : { tailwind: lint.tailwind }),
  };
}
