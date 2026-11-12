/** The `knip` section of workerstack.config.ts: the sanctioned knip ignores. */
import { z } from "zod";

/** One `knip.ignore` entry: the file, dependency or binary knip is not to report, and why it cannot see the use. */
export type KnipIgnore =
  | {
      /** The file knip is not to report as unused, relative to the repo root. */
      file: string;
      /** Why knip cannot see the file's use. */
      reason: string;
    }
  | {
      /** The dependency knip is not to report as unused. */
      dependency: string;
      /** Why knip cannot see the dependency's use. */
      reason: string;
    }
  | {
      /** The binary knip is not to report as unlisted. */
      binary: string;
      /** Why knip cannot see the binary's use. */
      reason: string;
    };

/** A `knip.ignore` entry as written: the schema refuses any that does not name exactly one of the three. */
export type KnipIgnoreEntry = {
  /** Why knip cannot see the use; the check fails the entry once knip would report nothing. */
  reason: string;
  /** The file knip is not to report as unused. */
  file?: string | undefined;
  /** The dependency knip is not to report as unused. */
  dependency?: string | undefined;
  /** The binary knip is not to report as unlisted. */
  binary?: string | undefined;
};

/** What the generated knip config and `repo check` read from `knip`. */
export type ResolvedKnip = {
  /** The sanctioned ignores; empty when the config lists none. */
  readonly ignore: readonly KnipIgnore[];
};

const REASON_ERROR = "say why knip cannot see the use";
const ONE_KEY_ERROR = "name exactly one of file, dependency or binary";
const IGNORE_LIST = "must be a list of { file | dependency | binary, reason } entries";

function name(error: string): z.ZodOptional<z.ZodString> {
  return z.string({ error }).min(1, { error }).optional();
}

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
        binary: name("binary must be a command name"),
        dependency: name("dependency must be a package name"),
        file: name("file must be a path"),
        reason: z.string({ error: REASON_ERROR }).min(1, { error: REASON_ERROR }),
      },
      { error: 'must be an object like { file: "src/a.ts", reason: "why" }' },
    )
    .transform((entry, ctx): KnipIgnore => {
      const { file, dependency, binary, reason } = entry;

      if (file !== undefined && dependency === undefined && binary === undefined) return { file, reason };

      if (dependency !== undefined && file === undefined && binary === undefined) return { dependency, reason };

      if (binary !== undefined && file === undefined && dependency === undefined) return { binary, reason };
      ctx.issues.push({ code: "custom", input: entry, message: ONE_KEY_ERROR });

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
