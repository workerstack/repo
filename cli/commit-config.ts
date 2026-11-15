/** The `commit` section of repo.config.ts: the size limit past which a message must say why, and the co-authors. */
import { z } from "zod";

import { ATTRIBUTION } from "./commit-msg.constants.ts";
import type { ResolvedCommit } from "./config-resolved.types.ts";

/** How many changed lines a commit may have before its message must say why. */
export const DEFAULT_MAX_CHANGED_LINES = 1000;

/** One co-author identity as git writes it: a name with no angle brackets, one space, then `<email>`. */
const IDENTITY = /^[^<>\s](?:[^<>]*[^<>\s])? <[^\s<>@]+@[^\s<>@]+>$/u;

const NOT_AN_IDENTITY = 'must be "Name <email>", like "Ada Lovelace <ada@example.com>"';

/** The schema of one `commit.coAuthors` entry: the identity shape, and no AI tool. */
function coAuthorSchema(): z.ZodString {
  return z
    .string({ error: NOT_AN_IDENTITY })
    .regex(IDENTITY, { error: NOT_AN_IDENTITY })
    .refine((identity) => !ATTRIBUTION.test(identity), { error: "names an AI tool; list only people" });
}

export function commitSchema(): z.ZodObject<
  {
    maxChangedLines: z.ZodOptional<z.ZodNumber>;
    coAuthors: z.ZodOptional<z.ZodReadonly<z.ZodArray<z.ZodString>>>;
  },
  z.core.$strict
> {
  return z.strictObject(
    {
      coAuthors: z.array(coAuthorSchema(), { error: 'must be a list of "Name <email>" strings' }).readonly().optional(),
      maxChangedLines: z
        .number({ error: "must be a whole number of lines above 0" })
        .int({ error: "must be a whole number of lines above 0" })
        .positive({ error: "must be a whole number of lines above 0" })
        .optional(),
    },
    { error: `must be an object like { maxChangedLines: ${DEFAULT_MAX_CHANGED_LINES} }` },
  );
}

/** The commit rules of a parsed `commit` section: the default limit and no co-authors for what it leaves out. */
export function resolveCommit(commit: z.output<ReturnType<typeof commitSchema>> | undefined): ResolvedCommit {
  return {
    coAuthors: commit?.coAuthors ?? [],
    maxChangedLines: commit?.maxChangedLines ?? DEFAULT_MAX_CHANGED_LINES,
  };
}
