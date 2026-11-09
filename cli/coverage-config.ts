/** The `coverage` section of workerstack.config.ts: where the floors and the known-failures list live, what to mutate. */
import { z } from "zod";

/** Where `repo coverage`, `repo mutate` and `repo check` read and write their ratchet files, relative to the repo root. */
export type ResolvedCoverage = {
  readonly floors: string;
  readonly knownFailures: string;
  /** The globs of the tracked files `repo mutate` mutates. */
  readonly mutate: readonly string[];
  readonly mutationFloors: string;
};

/** The files a config gets when it omits `coverage` or one of its keys. */
export const DEFAULT_COVERAGE: ResolvedCoverage = {
  floors: "coverage-floors.json",
  knownFailures: "known-failures.json",
  mutate: ["src/**/*.ts"],
  mutationFloors: "mutation-floors.json",
};

const PATH_ERROR = `must be a file path like ${DEFAULT_COVERAGE.floors}`;
const GLOBS_ERROR = 'must be a non-empty list of globs like ["src/**/*.ts"]';

type FileSchema = z.ZodOptional<z.ZodString>;
type CoverageSchema = z.ZodObject<
  {
    floors: FileSchema;
    knownFailures: FileSchema;
    mutate: z.ZodOptional<z.ZodArray<z.ZodString>>;
    mutationFloors: FileSchema;
  },
  z.core.$strict
>;

function buildSchema(): CoverageSchema {
  const file = z.string({ error: PATH_ERROR }).min(1, { error: PATH_ERROR }).optional();
  const globs = z
    .array(z.string({ error: GLOBS_ERROR }).min(1, { error: GLOBS_ERROR }), { error: GLOBS_ERROR })
    .min(1, { error: GLOBS_ERROR })
    .optional();
  return z.strictObject(
    { floors: file, knownFailures: file, mutate: globs, mutationFloors: file },
    { error: `must be an object like { floors: "${DEFAULT_COVERAGE.floors}" }` },
  );
}

export const coverageSchema: CoverageSchema = /* @__PURE__ */ buildSchema();

/** The parsed config's `coverage` section with every omitted key filled in. */
export function coverageOf(parsed: { coverage?: z.output<typeof coverageSchema> | undefined }): {
  coverage: ResolvedCoverage;
} {
  const { floors, knownFailures, mutate, mutationFloors } = parsed.coverage ?? {};
  return {
    coverage: {
      floors: floors ?? DEFAULT_COVERAGE.floors,
      knownFailures: knownFailures ?? DEFAULT_COVERAGE.knownFailures,
      mutate: mutate ?? DEFAULT_COVERAGE.mutate,
      mutationFloors: mutationFloors ?? DEFAULT_COVERAGE.mutationFloors,
    },
  };
}
