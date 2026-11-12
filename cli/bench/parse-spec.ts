/** The edge between a spec file's default export and the runner: one zod parse, one line per bad field. */
import { z } from "zod";

import {
  BUILT_IN,
  DEFAULT_RUNS,
  DEFAULT_WARMUP,
  LAST,
  MIN_RUNS,
  NAME,
  OS_LABELS,
  type OsLabel,
} from "./bench.constants.ts";
import type { Better } from "./spec.ts";

/** A candidate as the runner reads it: its name, its command, and the command run once before, if any. */
export type Candidate = { name: string; run: string[]; setup: string[] | null };

/** A metric as the runner reads it, with its unit filled in. */
export type Metric = { name: string; weight: number; better: Better; unit: string };

/** A parsed spec: candidates by name, metrics by weight (heaviest first) then name, whatever the file's key order. */
export type Spec = { candidates: Candidate[]; metrics: Metric[]; runs: number; warmup: number; os: OsLabel[] };

export type ParsedSpec = { ok: true; spec: Spec } | { ok: false; errors: string[] };

const NOT_SPEC = "the default export is not a bench spec; export default defineBench({ candidates, metrics })";

/** `a, b or c`: every bench os label. */
function osList() {
  return `${OS_LABELS.slice(0, LAST).join(", ")} or ${OS_LABELS.slice(LAST).join("")}`;
}

function notName(issue: { input: unknown }) {
  return `${JSON.stringify(issue.input)} is not a name; use a-z, 0-9 and -`;
}

function underMin(issue: { input: unknown }) {
  return `${String(issue.input)} is under ${MIN_RUNS}; a median and CV need at least 3 runs`;
}

function nameSchema() {
  return z.string().regex(NAME, { error: notName });
}

/** A record of at least one entry, keyed by names. */
function namedSchema<T extends z.ZodType>(value: T) {
  return z.record(nameSchema(), value).refine((entries) => Object.keys(entries).length > 0, {
    error: "none; add at least one",
  });
}

function candidateSchema() {
  const command = z.array(z.string()).min(1, { error: "empty; give the command and its args" });

  return z.strictObject({ run: command, setup: command.optional() });
}

function metricSchema() {
  return z.strictObject({
    better: z.enum(["lower", "higher"]).default("lower"),
    unit: z.string().optional(),
    weight: z.number().gt(0, { error: (issue) => `${String(issue.input)} is not over 0` }),
  });
}

/** A built-in metric takes only a weight: its unit and direction are fixed. */
function refuseBuiltIn(metrics: Record<string, z.infer<ReturnType<typeof metricSchema>>>, ctx: z.RefinementCtx) {
  for (const [name, metric] of Object.entries(metrics)) {
    const builtIn = BUILT_IN[name];

    if (builtIn === undefined) continue;

    if (metric.better === "higher")
      ctx.addIssue({ code: "custom", message: `${name} is built in and lower is better`, path: [name, "better"] });

    if (metric.unit !== undefined) {
      const message = `${name} is built in and measured in ${builtIn.unit}`;
      ctx.addIssue({ code: "custom", message, path: [name, "unit"] });
    }
  }
}

function wholeSchema() {
  return z.number().int({ error: (issue) => `${String(issue.input)} is not a whole number` });
}

function specSchema() {
  const os = z.enum(OS_LABELS, {
    error: (issue) => `${JSON.stringify(issue.input)} is not a bench os; use ${osList()}`,
  });

  return z.strictObject({
    candidates: namedSchema(candidateSchema()),
    metrics: namedSchema(metricSchema()).superRefine(refuseBuiltIn),
    os: z.array(os).default([]),
    runs: wholeSchema().min(MIN_RUNS, { error: underMin }).default(DEFAULT_RUNS),
    warmup: wholeSchema()
      .min(0, { error: (issue) => `${String(issue.input)} is under 0` })
      .default(DEFAULT_WARMUP),
  });
}

/** One line per issue: its field path (array indexes and a bad record key dropped) and what to do. */
function line(issue: z.core.$ZodIssue): string {
  const isKeyed = issue.code === "invalid_key";
  const message = isKeyed ? issue.issues.map((inner) => inner.message).join("; ") : issue.message;
  const segments = (isKeyed ? issue.path.slice(0, LAST) : issue.path).filter((part) => typeof part === "string");

  if (segments.length > 0) return `${segments.join(".")}: ${message}`;

  return issue.code === "invalid_type" ? NOT_SPEC : message;
}

/** Metric order: heaviest weight first, then by name, so a spec's key order never changes its columns. */
export function byWeight(a: Metric, b: Metric): number {
  return a.weight === b.weight ? a.name.localeCompare(b.name, "en") : b.weight - a.weight;
}

/** Parses a spec file's default export into a `Spec`, or every line saying what is wrong with it. */
export function parseSpec(value: unknown): ParsedSpec {
  const parsed = specSchema().safeParse(value);

  if (!parsed.success) return { errors: parsed.error.issues.map(line), ok: false };
  const { candidates, metrics, os, runs, warmup } = parsed.data;
  const named = Object.entries(candidates).map(([name, { run, setup }]) => ({ name, run, setup: setup ?? null }));

  const scored = Object.entries(metrics).map(([name, { better, unit, weight }]) => ({
    better,
    name,
    unit: BUILT_IN[name]?.unit ?? unit ?? "",
    weight,
  }));

  return {
    ok: true,
    spec: {
      candidates: named.toSorted((a, b) => a.name.localeCompare(b.name, "en")),
      metrics: scored.toSorted(byWeight),
      os,
      runs,
      warmup,
    },
  };
}
