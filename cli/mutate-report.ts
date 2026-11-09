/** The two reports of `repo mutate`: Stryker's json report in, a shard's own report out and read back. */
import { z } from "zod";
import { KILLED_STATUSES, SURVIVOR_STATUSES } from "./mutate.constants.ts";

/** A mutant no test killed. */
type Survivor = { line: number; column: number; mutator: string; status: "Survived" | "NoCoverage" };
/** One file's mutants: how many tests killed and the ones that lived. */
export type FileScore = { killed: number; survivors: Survivor[] };
/** What one shard run writes: the commit it mutated, which shard of how many, and its files' scores. */
export type ShardReport = { head: string; shard: { index: number; total: number }; files: Record<string, FileScore> };

function buildSchemas() {
  const stryker = z.object({
    files: z.record(
      z.string(),
      z.object({
        mutants: z.array(
          z.object({
            status: z.string(),
            mutatorName: z.string(),
            location: z.object({ start: z.object({ line: z.number(), column: z.number() }) }),
          }),
        ),
      }),
    ),
  });
  const survivor = z.object({
    line: z.number(),
    column: z.number(),
    mutator: z.string(),
    status: z.enum(["Survived", "NoCoverage"]),
  });
  const report = z.object({
    head: z.string(),
    shard: z.object({ index: z.number().int().min(1), total: z.number().int().min(1) }),
    files: z.record(z.string(), z.object({ killed: z.number(), survivors: z.array(survivor) })),
  });
  return { stryker, report };
}

const schemas = /* @__PURE__ */ buildSchemas();

export type Parsed<T> = { ok: true; value: T } | { ok: false; reason: string };

const reasonOf = (error: z.ZodError): string =>
  error.issues.map((issue) => `${issue.path.join(".") || "report"}: ${issue.message}`).join("; ");

type Mutant = z.output<typeof schemas.stryker>["files"][string]["mutants"][number];

function survivorOf(mutant: Mutant): Survivor[] {
  if (!SURVIVOR_STATUSES.includes(mutant.status)) return [];
  const { line, column } = mutant.location.start;
  return [
    {
      line,
      column,
      mutator: mutant.mutatorName,
      status: mutant.status /* SURVIVOR_STATUSES lists exactly the two statuses */ as Survivor["status"],
    },
  ];
}

/** Stryker's report as per-file scores: Killed and Timeout kill, Survived and NoCoverage survive, the rest is left out. */
export function fromStryker(raw: unknown): Parsed<Record<string, FileScore>> {
  const parsed = schemas.stryker.safeParse(raw);
  if (!parsed.success) return { ok: false, reason: reasonOf(parsed.error) };
  const files = Object.entries(parsed.data.files).map(([file, { mutants }]): [string, FileScore] => [
    file,
    {
      killed: mutants.filter((mutant) => KILLED_STATUSES.includes(mutant.status)).length,
      survivors: mutants.flatMap(survivorOf),
    },
  ]);
  return { ok: true, value: Object.fromEntries(files) };
}

/** JSON text as a value, or why it is no JSON. */
export function parseJson(text: string): Parsed<unknown> {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (error) {
    return { ok: false, reason: String(error) };
  }
}

/** A shard report read from JSON text. */
export function parseReport(text: string): Parsed<ShardReport> {
  const json = parseJson(text);
  if (!json.ok) return json;
  const parsed = schemas.report.safeParse(json.value);
  return parsed.success ? { ok: true, value: parsed.data } : { ok: false, reason: reasonOf(parsed.error) };
}

/** The survivors of every file of a report. */
export const survivorCount = (files: Record<string, FileScore>): number =>
  Object.values(files).reduce((sum, file) => sum + file.survivors.length, 0);
