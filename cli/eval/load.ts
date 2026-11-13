/** The edge between an eval file's default export and the runner: one zod parse, one line for the first problem. */
import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { z } from "zod";

import { DEFAULT_MAX_TOKENS, DEFAULT_MODEL, DEFAULT_SAMPLES } from "./price.constants.ts";
import type { EvalCase, ResolvedEval } from "./spec.ts";

export type LoadedEval = { ok: true; spec: ResolvedEval } | { ok: false; message: string };

const NOT_EVAL = "the default export is not an eval; export default defineEval({ system, cases })";

/** True for a function: the check a case runs on a model answer. */
function isCheck(value: unknown): value is EvalCase["pass"] {
  return typeof value === "function";
}

function caseSchema() {
  return z.strictObject({
    control: z.boolean().default(false),
    id: z.string().min(1, { error: "empty; give the case a name" }),
    input: z.string(),
    pass: z.custom<EvalCase["pass"]>(isCheck, { error: "not a function" }),
    source: z.string(),
  });
}

/** Refuses a case id used twice. */
function refuseDuplicates(cases: readonly { id: string }[], ctx: z.RefinementCtx): void {
  const seen = new Set<string>();

  for (const { id } of cases) {
    if (seen.has(id)) ctx.addIssue({ code: "custom", message: `duplicate case id ${JSON.stringify(id)}` });
    seen.add(id);
  }
}

/** A listed path: posix, and a file or folder under `root`. */
function fileSchema(root: string) {
  return z.string().superRefine((rel, ctx) => {
    if (rel.includes("\\")) ctx.addIssue({ code: "custom", message: `use / in ${rel}` });
    else if (!existsSync(path.join(root, rel))) ctx.addIssue({ code: "custom", message: `no file or folder ${rel}` });
  });
}

function evalSchema(root: string) {
  return z.strictObject({
    cases: z.array(caseSchema()).min(1, { error: "none; add at least one" }).superRefine(refuseDuplicates),
    files: z.array(fileSchema(root)).default([]),
    maxTokens: z.number().int().min(1, { error: "under 1" }).default(DEFAULT_MAX_TOKENS),
    model: z.string().default(DEFAULT_MODEL),
    samples: z.number().int().min(1, { error: "under 1; run at least one sample" }).default(DEFAULT_SAMPLES),
    system: z.string(),
  });
}

function line(issue: z.core.$ZodIssue): string {
  const field = issue.path.map(String).join(".");

  return field === "" ? NOT_EVAL : `${field}: ${issue.message}`;
}

/** Loads `<root>/evals/<name>/eval.ts` and returns its spec with defaults, or one line saying what is wrong. */
export async function loadEval(root: string, name: string): Promise<LoadedEval> {
  const file = path.join(root, "evals", name, "eval.ts");

  if (!existsSync(file)) return { message: `eval: no evals/${name}/eval.ts`, ok: false };
  // Any module has an optional default export; the schema below checks it.
  const module = (await import(pathToFileURL(file).href)) /* an import has this shape */ as { default?: unknown };
  const parsed = evalSchema(root).safeParse(module.default);

  if (!parsed.success) return { message: `eval ${name}: ${parsed.error.issues.map(line).join("; ")}`, ok: false };

  return { ok: true, spec: parsed.data };
}
