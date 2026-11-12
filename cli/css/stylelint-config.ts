/**
 * The Stylelint config the runner lints with: stylelint-config-standard, the Tailwind v4 pack and recess property
 * order. The config lives here, never in the consumer's tree, so each pack resolves from this package's install.
 */
import type { Config } from "stylelint";
import { z } from "zod";

import { EXTENDS, STRING_AT_RULES, STRING_PRELUDE, TAILWIND_PACK } from "./stylelint.constants.ts";

type Syntax = NonNullable<NonNullable<Config["languageOptions"]>["syntax"]>;

/** The part of the Tailwind pack's config read here: its syntax defs. */
function packSchema() {
  const atRule = z.object({
    comment: z.string().exactOptional(),
    descriptors: z.record(z.string(), z.string()).exactOptional(),
    prelude: z.string().exactOptional(),
  });

  const syntax = z.object({
    atRules: z.record(z.string(), atRule),
    properties: z.record(z.string(), z.string()).exactOptional(),
    types: z.record(z.string(), z.string()).exactOptional(),
  });

  return z.object({ default: z.object({ languageOptions: z.object({ syntax }) }) });
}

/** The Tailwind pack's syntax defs; loaded by a name held in a variable, as the pack ships no types. */
async function tailwindSyntax(): Promise<Syntax> {
  const name: string = TAILWIND_PACK;
  const pack: unknown = await import(name);

  return packSchema().parse(pack).default.languageOptions.syntax;
}

/**
 * The config object. A top-level `languageOptions.syntax` replaces the extended pack's, so its defs are spread first
 * and `@config` and `@plugin`, which it lacks, added after.
 */
export async function stylelintConfig(): Promise<Config> {
  const syntax = await tailwindSyntax();
  const added = Object.fromEntries(STRING_AT_RULES.map((name) => [name, { prelude: STRING_PRELUDE }]));

  return {
    extends: [...EXTENDS],
    languageOptions: { syntax: { ...syntax, atRules: { ...syntax.atRules, ...added } } },
  };
}
