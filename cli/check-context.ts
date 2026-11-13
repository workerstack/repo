/**
 * The ceiling on the agent context the package ships, held against main: `context-budget.json` holds the bytes of
 * the rules, the skill descriptions and the index, and a bucket may only rise over main's copy with a line in
 * `.repo/context-growth.jsonl` that names the rise and why.
 * The budget is bytes, not tokens: bytes are exact and need no tokenizer, and what limits a bucket is what the agent
 * loads at session start (every rule file, every skill description, the index), so each is summed whole, never
 * sampled. A byte count says nothing of how a model tokenizes it; it only moves when the text does.
 * The check runs only when the budget file exists at the root, so consumers never see it.
 */
import fs from "node:fs";
import path from "node:path";

import { z } from "zod";

import {
  BUCKETS,
  BUDGET_PATH,
  INDEX_PATH,
  JSON_INDENT,
  LEDGER_PATH,
  NOT_FOUND,
  REASON_FLAG,
  RULES_DIR,
  RULES_EXT,
  SKILL_FILE,
  SKILLS_DIR,
  STALE,
  WRITE_FLAG,
  needsReason,
  riseMessage,
  written,
} from "./check-context.constants.ts";
import { tryJson } from "./json.ts";
import { mainRef, showOnMain } from "./main-ref.ts";
import { parseDoc } from "./sync/agents/frontmatter.ts";

/** The key order of a ledger line. */
const LEDGER_KEYS = ["bucket", "from", "to", "reason"];

type Bucket = (typeof BUCKETS)[number];

/** Bytes per bucket. */
export type Budget = Record<Bucket, number>;

/** Main's copy of a root-relative file; null when it has none. */
export type MainReader = (rel: string) => string | null;

/** What `--write` did: its one line, and whether it went through. */
export type Written = { ok: boolean; message: string };

/** What `repo check` was told about the context budget. */
export type ContextFlags = { write: boolean; reason: string | undefined };

function budgetSchema(): z.ZodType<Budget> {
  return z.object({ index: z.number(), rules: z.number(), skills: z.number() });
}

function rowSchema() {
  return z.object({ bucket: z.string(), from: z.number(), to: z.number() });
}

function descriptionSchema() {
  return z.object({ description: z.string() });
}

function readText(file: string): string | null {
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
}

function bytes(text: string | null): number {
  return text === null ? 0 : Buffer.byteLength(text);
}

function descriptionBytes(rel: string, file: string): number {
  try {
    const read = descriptionSchema().safeParse(parseDoc(rel, fs.readFileSync(file, "utf8")).data);

    return read.success ? Buffer.byteLength(read.data.description) : 0;
  } catch {
    return 0;
  }
}

type Rise = [Bucket, number, number];

type Step = { from: number; to: number };

/** Whether `steps` chain from `from` to `to`, each step used at most once. */
function chains(steps: Step[], from: number, to: number): boolean {
  if (from === to) return true;

  return steps.some(
    (step, at) =>
      step.from === from &&
      chains(
        steps.filter((_, other) => other !== at),
        step.to,
        to,
      ),
  );
}

/**
 * Whether the ledger records this rise: one line for it, or the bucket's lines in a chain from main's value to the
 * measure.
 */
function isRecorded(recorded: { bucket: string; from: number; to: number }[], [bucket, from, to]: Rise): boolean {
  return chains(
    recorded.filter((row) => row.bucket === bucket),
    from,
    to,
  );
}

function sum(values: number[]): number {
  return values.reduce((a, b) => a + b, 0);
}

function dirNames(dir: string): string[] {
  return fs.existsSync(dir) ? fs.readdirSync(dir) : [];
}

/** The bytes of each bucket under `root`: rule files whole, skill descriptions only, the index whole. */
export function measure(root: string): Budget {
  const rules = dirNames(path.join(root, RULES_DIR)).filter((name) => name.endsWith(RULES_EXT));
  const skills = dirNames(path.join(root, SKILLS_DIR)).map((dir) => path.join(SKILLS_DIR, dir, SKILL_FILE));

  return {
    index: bytes(readText(path.join(root, INDEX_PATH))),
    rules: sum(rules.map((name) => bytes(readText(path.join(root, RULES_DIR, name))))),
    skills: sum(
      skills
        .filter((rel) => fs.existsSync(path.join(root, rel)))
        .map((rel) => descriptionBytes(rel, path.join(root, rel))),
    ),
  };
}

/** The reader of main's files for the checkout at `root`; null when there is no main ref. */
function mainReader(root: string): MainReader | null {
  const ref = mainRef(root);

  return ref === null ? null : (rel) => showOnMain(root, ref, rel);
}

function budgetOf(text: string | null): Budget | undefined {
  return text === null ? undefined : tryJson(budgetSchema(), text);
}

/** The ledger's lines; text that is no JSON row is skipped. */
function ledger(root: string): { bucket: string; from: number; to: number }[] {
  const lines = (readText(path.join(root, LEDGER_PATH)) ?? "").split("\n");

  return lines.flatMap((line) => {
    const row = tryJson(rowSchema(), line);

    return row === undefined ? [] : [row];
  });
}

/** The buckets whose bytes rose over main's budget, as `[bucket, from, to]`. */
function rises(measured: Budget, main: MainReader | null): Rise[] {
  const was = main === null ? undefined : budgetOf(main(BUDGET_PATH));

  if (was === undefined) return [];

  return BUCKETS.filter((bucket) => measured[bucket] > was[bucket]).map((bucket) => [
    bucket,
    was[bucket],
    measured[bucket],
  ]);
}

/**
 * The problems of the context budget at `root`: none without a budget file, a file that differs from the measure is
 * stale, and a rise over main's file needs that bucket's ledger lines to chain from main's value to the measured one.
 */
export function contextProblems(root: string, main: MainReader | null = mainReader(root)): string[] {
  const text = readText(path.join(root, BUDGET_PATH));

  if (text === null) return [];
  const measured = measure(root);
  const have = budgetOf(text);

  if (have === undefined || BUCKETS.some((bucket) => have[bucket] !== measured[bucket])) return [STALE];
  const recorded = ledger(root);

  return rises(measured, main)
    .filter((rise) => !isRecorded(recorded, rise))
    .map(([bucket, from, to]) => riseMessage(bucket, from, to));
}

/** `--write` and the text after `--reason` among check's arguments. */
export function parseContextFlags(args: readonly string[]): ContextFlags {
  const at = args.indexOf(REASON_FLAG);

  return { reason: at === NOT_FOUND ? undefined : args[at + 1], write: args.includes(WRITE_FLAG) };
}

/**
 * Writes the budget from the measure and a ledger line per rise over main; a rise with no reason writes nothing. A line
 * the ledger already holds is not added again.
 */
export function writeContext(
  root: string,
  { reason }: ContextFlags,
  main: MainReader | null = mainReader(root),
): Written {
  const measured = measure(root);
  const grown = rises(measured, main);

  if (grown.length > 0 && reason === undefined)
    return { message: needsReason(grown.map(([bucket, from, to]) => `${bucket} ${from} -> ${to}`)), ok: false };

  const known = ledger(root);
  const fresh = grown.filter((rise) => !isRecorded(known, rise));
  const lines = fresh.map(([bucket, from, to]) => `${JSON.stringify({ bucket, from, reason, to }, LEDGER_KEYS)}\n`);
  fs.writeFileSync(path.join(root, BUDGET_PATH), `${JSON.stringify(measured, [...BUCKETS], JSON_INDENT)}\n`);

  if (lines.length > 0) {
    fs.mkdirSync(path.dirname(path.join(root, LEDGER_PATH)), { recursive: true });
    fs.appendFileSync(path.join(root, LEDGER_PATH), lines.join(""));
  }

  return { message: written(lines.length), ok: true };
}
