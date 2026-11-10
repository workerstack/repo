/** The two reports of `repo mutate`: Stryker's json report in, a shard's own report out and read back. */
import { z } from "zod";
import { CARGO_KILLED, CARGO_MISSED, KILLED_STATUSES, SURVIVOR_STATUSES } from "./mutate.constants.ts";

/** A mutant no test killed. */
type Survivor = {
  line: number;
  column: number;
  mutator: string;
  status: "Survived" | "NoCoverage";
};
/** One file's mutants: how many tests killed and the ones that lived. */
export type FileScore = { killed: number; survivors: Survivor[] };
/** The mutation tool a report came from. */
type Tool = "stryker" | "cargo-mutants";
/** What one shard run writes: the tool, the commit it mutated, which shard of how many, and its files' scores. */
export type ShardReport = {
  tool: Tool;
  head: string;
  shard: { index: number; total: number };
  files: Record<string, FileScore>;
};

const position = () => z.object({ line: z.number(), column: z.number() });

function strykerSchema() {
  const mutant = z.object({
    status: z.string(),
    mutatorName: z.string(),
    location: z.object({ start: position() }),
  });
  return z.object({ files: z.record(z.string(), z.object({ mutants: z.array(mutant) })) });
}

function cargoMutantsSchema() {
  const mutant = z.object({ file: z.string(), genre: z.string(), span: z.object({ start: position() }) });
  const scenario = z.union([z.string(), z.object({ Failure: z.number() }), z.object({ Mutant: mutant })]);
  return z.object({ outcomes: z.array(z.object({ scenario, summary: z.string() })) });
}

function reportSchema() {
  const survivor = position().extend({ mutator: z.string(), status: z.enum(["Survived", "NoCoverage"]) });
  return z.object({
    tool: z.enum(["stryker", "cargo-mutants"]),
    head: z.string(),
    shard: z.object({ index: z.number().int().min(1), total: z.number().int().min(1) }),
    files: z.record(z.string(), z.object({ killed: z.number(), survivors: z.array(survivor) })),
  });
}

const buildSchemas = () => ({ stryker: strykerSchema(), cargoMutants: cargoMutantsSchema(), report: reportSchema() });

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

type Outcome = z.output<typeof schemas.cargoMutants>["outcomes"][number];
type Found = { file: string; score: FileScore };

function scoreOf(outcome: Outcome): Found[] {
  const { scenario, summary } = outcome;
  if (typeof scenario === "string" || !("Mutant" in scenario)) return [];
  const { file, genre, span } = scenario.Mutant;
  const { line, column } = span.start;
  const killed = CARGO_KILLED.includes(summary) ? 1 : 0;
  const survivors: Survivor[] = summary === CARGO_MISSED ? [{ line, column, mutator: genre, status: "Survived" }] : [];
  return [{ file, score: { killed, survivors } }];
}

/** cargo-mutants' outcomes.json as per-file scores: CaughtMutant and Timeout kill, MissedMutant survives, the rest is left out. */
export function fromCargoMutants(raw: unknown): Parsed<Record<string, FileScore>> {
  const parsed = schemas.cargoMutants.safeParse(raw);
  if (!parsed.success) return { ok: false, reason: reasonOf(parsed.error) };
  const files: Record<string, FileScore> = {};
  for (const { file, score } of parsed.data.outcomes.flatMap(scoreOf)) {
    const into = (files[file] ??= { killed: 0, survivors: [] });
    into.killed += score.killed;
    into.survivors.push(...score.survivors);
  }
  return { ok: true, value: files };
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

/** Every shard's files as one map; a file two shards both hold (cargo-mutants splits mutants, not files) sums. */
export function mergeFiles(reports: readonly ShardReport[]): Record<string, FileScore> {
  const files: Record<string, FileScore> = {};
  for (const [file, score] of reports.flatMap((r) => Object.entries(r.files))) {
    const held = files[file];
    files[file] = held
      ? { killed: held.killed + score.killed, survivors: [...held.survivors, ...score.survivors] }
      : score;
  }
  return files;
}
