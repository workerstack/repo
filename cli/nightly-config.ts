/** The `nightly` section of workerstack.config.ts: how many shards the nightly mutation run has, which secrets its live job gets. */
import { z } from "zod";

import {
  MAX_SHARDS,
  MIN_SHARDS,
  RESERVED_PREFIX,
  SECRETS_ERROR,
  SECRET_ERROR,
  SECRET_NAME,
  SECTION_ERROR,
  SHARDS_ERROR,
  TWICE,
} from "./nightly-config.constants.ts";

/** What the generated nightly workflow reads. */
export type ResolvedNightly = {
  /** How many parallel shards the nightly mutation run is split into. */
  readonly shards: number;
  /** Names of the repo secrets the live-test job gets as environment variables. */
  readonly secrets: readonly string[];
};

/** The nightly run a config gets when it omits `nightly` or one of its keys. */
export const DEFAULT_NIGHTLY: ResolvedNightly = { secrets: [], shards: 1 };

type NightlySchema = z.ZodObject<
  {
    shards: z.ZodOptional<z.ZodNumber>;
    secrets: z.ZodOptional<z.ZodReadonly<z.ZodArray<z.ZodString>>>;
  },
  z.core.$strict
>;

function buildSchema(): NightlySchema {
  const secret = z
    .string({ error: SECRET_ERROR })
    .regex(SECRET_NAME, { error: SECRET_ERROR })
    .refine((name) => !name.startsWith(RESERVED_PREFIX), { error: SECRET_ERROR });
  const secrets = z
    .array(secret, { error: SECRETS_ERROR })
    .readonly()
    .superRefine((names, ctx) => {
      const counts = new Map<string, number>();
      for (const name of names) counts.set(name, (counts.get(name) ?? 0) + 1);
      for (const [name, count] of counts) {
        if (count === 1) continue;
        const times = count === TWICE ? "twice" : `${count} times`;
        ctx.addIssue({ code: "custom", message: `${JSON.stringify(name)} is listed ${times}` });
      }
    });
  const shards = z
    .number({ error: SHARDS_ERROR })
    .int({ error: SHARDS_ERROR })
    .min(MIN_SHARDS, { error: SHARDS_ERROR })
    .max(MAX_SHARDS, { error: SHARDS_ERROR });
  return z.strictObject({ secrets: secrets.optional(), shards: shards.optional() }, { error: SECTION_ERROR });
}

export const nightlySchema: NightlySchema = /* @__PURE__ */ buildSchema();

/** The parsed config's `nightly` section with every omitted key filled in. */
export function nightlyOf(parsed: { nightly?: z.output<typeof nightlySchema> | undefined }): {
  nightly: ResolvedNightly;
} {
  const { shards, secrets } = parsed.nightly ?? {};
  return { nightly: { secrets: secrets ?? DEFAULT_NIGHTLY.secrets, shards: shards ?? DEFAULT_NIGHTLY.shards } };
}
