/** The `knip` section of workerstack.config.ts: the sanctioned knip ignores. */
import { z } from "zod";

/** One `knip.ignore` entry: the file, dependency or binary knip is not to report, and why it cannot see the use. */
export type KnipIgnore =
  | { file: string; reason: string }
  | { dependency: string; reason: string }
  | { binary: string; reason: string };
/** A `knip.ignore` entry as written: the schema refuses any that does not name exactly one of the three. */
export type KnipIgnoreEntry = {
  reason: string;
  file?: string | undefined;
  dependency?: string | undefined;
  binary?: string | undefined;
};
/** What the generated knip config and `repo check` read from `knip`. */
export type ResolvedKnip = { readonly ignore: readonly KnipIgnore[] };

const REASON_ERROR = "say why knip cannot see the use";
const ONE_KEY_ERROR = "name exactly one of file, dependency or binary";
const IGNORE_LIST = "must be a list of { file | dependency | binary, reason } entries";

const name = (error: string): z.ZodOptional<z.ZodString> => z.string({ error }).min(1, { error }).optional();

type EntrySchema = z.ZodPipe<
  z.ZodObject<
    {
      file: z.ZodOptional<z.ZodString>;
      dependency: z.ZodOptional<z.ZodString>;
      binary: z.ZodOptional<z.ZodString>;
      reason: z.ZodString;
    },
    z.core.$strict
  >,
  z.ZodTransform<KnipIgnore, KnipIgnoreEntry>
>;
type KnipSchema = z.ZodObject<{ ignore: z.ZodOptional<z.ZodReadonly<z.ZodArray<EntrySchema>>> }, z.core.$strict>;

/** One ignore: exactly one of `file`, `dependency` or `binary`, and why knip cannot see the use. */
function entrySchema(): EntrySchema {
  return z
    .strictObject(
      {
        file: name("file must be a path"),
        dependency: name("dependency must be a package name"),
        binary: name("binary must be a command name"),
        reason: z.string({ error: REASON_ERROR }).min(1, { error: REASON_ERROR }),
      },
      { error: 'must be an object like { file: "src/a.ts", reason: "why" }' },
    )
    .transform((entry, ctx): KnipIgnore => {
      const { file, dependency, binary, reason } = entry;
      if (file !== undefined && dependency === undefined && binary === undefined) return { file, reason };
      if (dependency !== undefined && file === undefined && binary === undefined) return { dependency, reason };
      if (binary !== undefined && file === undefined && dependency === undefined) return { binary, reason };
      ctx.issues.push({ code: "custom", message: ONE_KEY_ERROR, input: entry });
      return z.NEVER;
    });
}

/** `knip`: the ignores, built when the config schema is. */
export function knipSchema(): KnipSchema {
  return z.strictObject(
    { ignore: z.array(entrySchema(), { error: IGNORE_LIST }).readonly().optional() },
    { error: "must be an object like { ignore: [{ file, reason }] }" },
  );
}
