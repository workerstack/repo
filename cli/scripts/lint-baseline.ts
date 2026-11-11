/**
 * `.repo/lint-baseline.json`: per file, per rule, how many lint problems the repo still carries. Only ever lowered
 * to the real counts (by `repo turn` for the files it lints, by `repo lint --baseline` for all); `--baseline` also
 * seeds a rule a file has no entry for. `repo check` fails on a count above its entry, an entry above its count and
 * an entry for a gone file. Worktrees each hold a copy; a merge conflict resolves either way, then `--baseline`
 * lowers it to the truth.
 */
import fs from "node:fs";
import path from "node:path";

import { z } from "zod";

import { findRoot, loadConfig } from "../config.ts";
import { OXLINT_CONFIG_PATH } from "../sync/oxlint-config.ts";
import { REPORT_START } from "./lint.constants.ts";
import { captureTool } from "./lint.ts";

export const BASELINE_PATH = ".repo/lint-baseline.json";
/** File → rule → problem count; a file or rule left out counts 0. */
export type Counts = Record<string, Record<string, number>>;
/** One rule of one file over its baseline entry. */
export type Excess = { file: string; rule: string; has: number; allows: number };
/** One entry `repo turn` lowered; `to` 0 drops it. */
export type Lowered = { file: string; rule: string; from: number; to: number };
export type Diagnostic = { file: string; rule: string; line: string };
export type Result<T> = { ok: true; value: T } | { ok: false; errors: string[] };

const LOWER = "run `bun repo lint --baseline`";
const PARSE_ERROR = "parse-error";
const count = z.number().int().positive({ error: "must be a whole number above 0" });
const baselineSchema = z.record(z.string(), z.record(z.string(), count, { error: "must be an object" }), {
  error: "must be an object",
});
const reportSchema = z.object({
  diagnostics: z.array(
    z.object({
      code: z.string().optional(),
      filename: z.string(),
      labels: z.array(z.object({ span: z.object({ column: z.number(), line: z.number() }) })).optional(),
      message: z.string(),
      severity: z.string(),
    }),
  ),
});

const byKey = (a: string, b: string) => Number(a > b) - Number(a < b);
const plural = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`;
const countOf = (counts: Counts, file: string, rule: string) => counts[file]?.[rule] ?? 0;

export const excessText = ({ file, rule, has, allows }: Excess): string =>
  `${file} has ${has} ${rule}, the baseline allows ${allows}`;

/** Every rule of `files` whose count in `actual` is above `baseline`, in file then rule order. */
function overOf(baseline: Counts, actual: Counts, files: readonly string[]): Excess[] {
  return [...files].sort(byKey).flatMap((file) =>
    Object.keys(actual[file] ?? {}).flatMap((rule) => {
      const has = countOf(actual, file, rule);
      const allows = countOf(baseline, file, rule);
      return has > allows ? [{ allows, file, has, rule }] : [];
    }),
  );
}

/** `counts` with empty files and zero rules dropped and keys sorted, as the file holds them. */
function normalized(counts: Counts): Counts {
  const entries = Object.entries(counts).map(([file, rules]) => {
    const kept = Object.entries(rules).filter(([, value]) => value > 0);
    return [file, Object.fromEntries(kept.sort(([a], [b]) => byKey(a, b)))] as const;
  });
  const sorted = entries.sort(([a], [b]) => byKey(a, b));
  return Object.fromEntries(sorted.filter(([, rules]) => Object.keys(rules).length > 0));
}

/**
 * The baseline gate over `files` (linted or deleted): what is over, the baseline with each of their entries lowered
 * to the real count, and what was lowered. Other files' entries stay as they are.
 */
export function gate(
  baseline: Counts,
  actual: Counts,
  files: readonly string[],
): {
  over: Excess[];
  next: Counts;
  lowered: Lowered[];
} {
  const next: Counts = { ...baseline };
  const lowered: Lowered[] = [];
  for (const file of [...files].sort(byKey)) {
    const entry = baseline[file];
    if (entry === undefined) continue;
    const rules = Object.keys(entry).sort(byKey);
    next[file] = Object.fromEntries(
      Object.entries(entry).map(([rule, allows]) => [rule, Math.min(allows, countOf(actual, file, rule))]),
    );
    for (const rule of rules) {
      const [from, to] = [countOf(baseline, file, rule), countOf(next, file, rule)];
      if (to < from) lowered.push({ file, from, rule, to });
    }
  }
  return { lowered, next: normalized(next), over: overOf(baseline, actual, files) };
}

/** `repo lint --baseline`: every entry lowered to its real count, a gone file dropped, a rule a file lacks seeded. */
function reseeded(baseline: Counts, actual: Counts): Counts {
  const next: Counts = gate(baseline, actual, Object.keys(baseline)).next;
  for (const [file, rules] of Object.entries(actual)) {
    for (const [rule, value] of Object.entries(rules))
      if (baseline[file]?.[rule] === undefined) next[file] = { ...next[file], [rule]: value };
  }
  return normalized(next);
}

/** What `repo check` reports: a count over its entry, an entry over its count, an entry for a file that is gone. */
function drift(baseline: Counts, actual: Counts, exists: (file: string) => boolean): string[] {
  const files = [...new Set([...Object.keys(baseline), ...Object.keys(actual)])].sort(byKey);
  return files.flatMap((file) => {
    if (!exists(file)) return [`${file} is gone; ${LOWER}`];
    const over = overOf(baseline, actual, [file]).map(excessText);
    const high = Object.keys(baseline[file] ?? {})
      .filter((rule) => countOf(actual, file, rule) < countOf(baseline, file, rule))
      .map((rule) => {
        const allows = countOf(baseline, file, rule);
        return `${excessText({ allows, file, has: countOf(actual, file, rule), rule })}; ${LOWER} to lower it`;
      });
    return [...over, ...high];
  });
}

/** The baseline under `root`, empty when the file is absent. */
export function readBaseline(root: string): Result<Counts> {
  const file = path.join(root, BASELINE_PATH);
  if (!fs.existsSync(file)) return { ok: true, value: {} };
  const fail = (lines: string[]): Result<Counts> => ({ errors: lines.map((l) => `${BASELINE_PATH}: ${l}`), ok: false });
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    return fail([`not valid JSON: ${(error as Error).message}; fix it, or delete it and ${LOWER}`]);
  }
  const parsed = baselineSchema.safeParse(raw);
  if (parsed.success) return { ok: true, value: parsed.data };
  return fail(
    parsed.error.issues.map(
      (issue) => `${[...issue.path, ""].join(": ")}${issue.message}; fix it, or delete it and ${LOWER}`,
    ),
  );
}

/** Writes `counts` sorted, as `JSON.stringify` indents it, which oxfmt leaves alone; through a rename, so no reader sees half. */
export function writeBaseline(root: string, counts: Counts): void {
  const file = path.join(root, BASELINE_PATH);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(normalized(counts), null, 2)}\n`);
  fs.renameSync(temp, file);
}

/**
 * oxlint's json report on `args` in `root` (no paths: the whole tree), one diagnostic per problem; `run` runs oxlint,
 * `captureTool` unless a caller injects another.
 */
export function lintReport(
  root: string,
  args: readonly string[],
  run: typeof captureTool = captureTool,
): Result<Diagnostic[]> {
  const ran = run("oxlint", ["-f", "json", ...args], root);
  let raw: unknown;
  try {
    raw = JSON.parse(ran.stdout.slice(Math.max(ran.stdout.search(REPORT_START), 0)));
  } catch {
    return { errors: [`oxlint exited ${ran.code}: ${`${ran.stdout}${ran.stderr}`.trim()}`], ok: false };
  }
  const report = reportSchema.parse(raw);
  const diagnostics = report.diagnostics.map((d) => {
    const rule = d.code ?? PARSE_ERROR;
    const span = d.labels?.[0]?.span;
    // A diagnostic without a label is placed at its file alone.
    const at = [d.filename, span?.line, span?.column].filter((part) => part !== undefined).join(":");
    return { file: d.filename, line: `${at}: ${d.severity} ${rule}: ${d.message}`, rule };
  });
  return { ok: true, value: diagnostics };
}

export function countsOf(diagnostics: readonly Diagnostic[]): Counts {
  const counts: Counts = {};
  for (const { file, rule } of diagnostics) counts[file] = { ...counts[file], [rule]: countOf(counts, file, rule) + 1 };
  return counts;
}

/** The whole tree's counts, oxlint's and the `scripts` hits no skip turns off, and the baseline under `root`. */
function measure(root: string, scripts: readonly Diagnostic[]): Result<{ baseline: Counts; actual: Counts }> {
  const baseline = readBaseline(root);
  if (!baseline.ok) return baseline;
  const report = lintReport(root, []);
  if (!report.ok) return report;
  return { ok: true, value: { actual: countsOf([...report.value, ...scripts]), baseline: baseline.value } };
}

/**
 * `repo lint --baseline` in `root`: every entry lowered to the real count, oxlint's and the `scripts` hits no skip turns
 * off, a gone file dropped and a rule a file lacks seeded; the exit code.
 */
export function seedBaseline(root: string, scripts: readonly Diagnostic[]): number {
  const measured = measure(root, scripts);
  if (!measured.ok) {
    for (const line of measured.errors) process.stderr.write(`repo lint: ${line}\n`);
    return 1;
  }
  const next = reseeded(measured.value.baseline, measured.value.actual);
  writeBaseline(root, next);
  const problems = Object.values(next).reduce((sum, rules) => sum + Object.values(rules).reduce((a, b) => a + b, 0), 0);
  const counted = `${plural(Object.keys(next).length, "file")}, ${plural(problems, "problem")}`;
  process.stdout.write(`repo lint: baseline written: ${counted}\n`);
  return 0;
}

/**
 * `repo check`'s lint lines over oxlint's and the `scripts` hits no skip turns off, each prefixed with the baseline
 * path: none when the repo has no config, the standards pack is off or sync has not written the oxlint config (sync
 * --check reports that).
 */
export async function checkLintBaseline(cwd: string, scripts: readonly Diagnostic[]): Promise<string[]> {
  const root = findRoot(cwd);
  if (root === null) return [];
  const loaded = await loadConfig(root);
  if (!loaded.ok || !loaded.config.packs.includes("standards")) return [];
  if (!fs.existsSync(path.join(root, OXLINT_CONFIG_PATH))) return [];
  const measured = measure(root, scripts);
  if (!measured.ok) return measured.errors;
  const exists = (file: string) => fs.existsSync(path.join(root, file));
  return drift(measured.value.baseline, measured.value.actual, exists).map((line) => `${BASELINE_PATH}: ${line}`);
}
