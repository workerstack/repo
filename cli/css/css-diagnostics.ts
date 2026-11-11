/**
 * Stylelint's warnings on a checkout's CSS as lint diagnostics the baseline counts, `stylelint(<rule>)` each. The
 * runner is a bun child evaluating `RUNNER_EVAL` on `stylelint-run.ts`, so the packs resolve from this package and the
 * callers stay sync.
 */
import path from "node:path";
import { pathToFileURL } from "node:url";

import { z } from "zod";

import type { Listed } from "../check-comments.ts";
import { codeOf } from "../lint/script-rules.ts";
import type { Diagnostic, Result } from "../scripts/lint-baseline.ts";
import { captureBun } from "../scripts/lint.ts";
import { runGit } from "../sync/standards.ts";
import {
  CANNOT_RUN,
  CSS_PATHSPEC,
  CSS_SOURCE,
  DEPENDENCY_EXCLUDE,
  FIX_FLAG,
  FIXTURES_DIR,
  RUNNER_EVAL,
  STYLELINT_PREFIX,
} from "./stylelint.constants.ts";

/**
 * Whether to fix the files first, and the module whose `main` the child runs (`stylelint-run.ts` by default; tests
 * hand one that fails).
 */
export type CssOptions = { fix: boolean; runner?: string };

type Warning = { column: number; line: number; rule: string; severity: string; text: string };
type FileResult = { invalid: { text: string }[]; source: string; warnings: Warning[] };

/** The runner module, beside this file. */
function runnerPath(): string {
  return path.join(import.meta.dirname, "stylelint-run.ts");
}

/** A stylesheet Stylelint lints: a `.css` file outside any fixtures dir. */
export function isLintedCss(rel: string): boolean {
  return CSS_SOURCE.test(rel) && !rel.split("/").includes(FIXTURES_DIR);
}

/** The tracked and untracked, not ignored, stylesheets under `root` that Stylelint lints, sorted. */
export function cssFiles(root: string): Listed {
  const run = runGit(root, [
    "ls-files",
    "-z",
    "--cached",
    "--others",
    "--exclude-standard",
    "--",
    CSS_PATHSPEC,
    DEPENDENCY_EXCLUDE,
  ]);
  if (run.status !== 0) return { errors: [`git ls-files failed: ${run.stderr.trim()}`], ok: false };
  return { files: [...new Set(run.stdout.split("\0").filter(isLintedCss))].toSorted(), ok: true };
}

/** The runner's json output. */
function resultsSchema(): z.ZodType<FileResult[]> {
  const warning = z.object({
    column: z.number(),
    line: z.number(),
    rule: z.string(),
    severity: z.string(),
    text: z.string(),
  });
  const invalid = z.array(z.object({ text: z.string() }));
  return z.array(z.object({ invalid, source: z.string(), warnings: z.array(warning) }));
}

function cannotRun(why: string): Result<never> {
  return { errors: [`${CANNOT_RUN}: ${why}`], ok: false };
}

/** The first line of `text`, trimmed. */
function firstLine(text: string): string {
  return text.trim().split("\n", 1).join("");
}

/** The runner's results read from its `stdout`, or why they could not be. */
function parsedResults(stdout: string): Result<FileResult[]> {
  let raw: unknown;
  try {
    raw = JSON.parse(stdout);
  } catch (error) {
    return cannotRun(String(error));
  }
  const parsed = resultsSchema().safeParse(raw);
  return parsed.success ? { ok: true, value: parsed.data } : cannotRun(firstLine(z.prettifyError(parsed.error)));
}

/** One warning of the file at `rel` as the line `repo lint` prints; the ` (<rule>)` ending each text dropped. */
function diagnosticOf(rel: string, warning: Warning): Diagnostic {
  const rule = codeOf(`${STYLELINT_PREFIX}${warning.rule}`);
  const message = warning.text.replace(` (${warning.rule})`, "");
  return { file: rel, line: `${rel}:${warning.line}:${warning.column}: ${warning.severity} ${rule}: ${message}`, rule };
}

/** File order, then line and column, read as numbers. */
function byPlace(a: Diagnostic, b: Diagnostic): number {
  const byFile = Number(a.file > b.file) - Number(a.file < b.file);
  return byFile === 0 ? a.line.localeCompare(b.line, "en", { numeric: true }) : byFile;
}

/**
 * Stylelint's warnings on the linted stylesheets among `files` (root-relative POSIX paths), fixed first with
 * `options.fix`, in file then position order. No child runs when none is left. Or the problem line: the runner failed
 * (its stderr's first line), printed what is not its results, or found an invalid option in the config.
 */
export function cssDiagnostics(root: string, files: readonly string[], options: CssOptions): Result<Diagnostic[]> {
  const sheets = files.filter(isLintedCss);
  if (sheets.length === 0) return { ok: true, value: [] };
  const runner = pathToFileURL(options.runner ?? runnerPath()).href;
  const run = captureBun(["--eval", RUNNER_EVAL, runner, ...(options.fix ? [FIX_FLAG] : []), ...sheets], root);
  if (run.code !== 0) return cannotRun(firstLine(run.stderr));
  const results = parsedResults(run.stdout);
  if (!results.ok) return results;
  const invalid = results.value.flatMap((result) => result.invalid);
  if (invalid.length > 0) return { errors: invalid.map(({ text }) => `${CANNOT_RUN}: ${text}`), ok: false };
  const value = results.value.flatMap((result) => {
    const rel = path.relative(root, result.source).split(path.sep).join("/");
    return result.warnings.map((warning) => diagnosticOf(rel, warning));
  });
  return { ok: true, value: value.toSorted(byPlace) };
}
