/** The `coverage` section of workerstack.config.ts: where the floors and the known-failures list live. */
import { z } from "zod";

/** Where `repo coverage` and `repo check` read and write their ratchet files, relative to the repo root. */
export type ResolvedCoverage = { readonly floors: string; readonly knownFailures: string };

/** The files a config gets when it omits `coverage` or one of its keys. */
export const DEFAULT_COVERAGE: ResolvedCoverage = {
  floors: "coverage-floors.json",
  knownFailures: "known-failures.json",
};

const PATH_ERROR = `must be a file path like ${DEFAULT_COVERAGE.floors}`;

type FileSchema = z.ZodOptional<z.ZodString>;
type CoverageSchema = z.ZodObject<{ floors: FileSchema; knownFailures: FileSchema }, z.core.$strict>;

function buildSchema(): CoverageSchema {
  const file = z.string({ error: PATH_ERROR }).min(1, { error: PATH_ERROR }).optional();
  return z.strictObject(
    { floors: file, knownFailures: file },
    { error: `must be an object like { floors: "${DEFAULT_COVERAGE.floors}" }` },
  );
}

export const coverageSchema: CoverageSchema = /* @__PURE__ */ buildSchema();

/** The parsed config's `coverage` section with every omitted path filled in. */
export function coverageOf(parsed: { coverage?: z.output<typeof coverageSchema> | undefined }): {
  coverage: ResolvedCoverage;
} {
  const { floors, knownFailures } = parsed.coverage ?? {};
  return {
    coverage: {
      floors: floors ?? DEFAULT_COVERAGE.floors,
      knownFailures: knownFailures ?? DEFAULT_COVERAGE.knownFailures,
    },
  };
}
