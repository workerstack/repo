/**
 * The steps of `repo turn`, each over the change set: fmt, lint with the baseline gate, typecheck, related tests,
 * then sync and check when their inputs changed. A step reports a summary label, whether it passed, the tool output
 * to print when it failed, and the files it rewrote, which `--staged` restages.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { sourceFiles } from "../check-comments.ts";
import { withoutSkipped } from "../check-magic.ts";
import { CONFIG_FILE } from "../config.constants.ts";
import { type LintSkip } from "../config.ts";
import { cssDiagnostics, isLintedCss } from "../css/css-diagnostics.ts";
import { scriptDiagnostics } from "../script-diagnostics.ts";
import { byCodeUnit } from "../sync/by-code-unit.ts";
import { readManifest } from "../sync/manifest.ts";
import type { Change } from "./change-set.ts";
import { fixPasses } from "./fix-passes.ts";
import { BASELINE_PATH } from "./lint-baseline.constants.ts";
import {
  countsOf,
  type Counts as Baseline,
  excessText,
  gate,
  lintReport,
  readBaseline,
  writeBaseline,
  type Diagnostic,
  type Excess,
  type Result,
} from "./lint-baseline.ts";
import { captureBun, captureSorted, captureTool, type Captured } from "./lint.ts";
import { LINTABLE } from "./lintable.constants.ts";
import { BUNFIG_FILE, LOCKFILES, MANIFEST_FILE } from "./turn-steps.constants.ts";

/** typescript, a dependency, and vitest, an optional peer: null when the package at `cwd` cannot resolve it. */
export type Bins = {
  tsc: (args: string[], cwd: string) => Captured;
  vitest: (args: string[], cwd: string) => Captured | null;
};

/** A change set to gate, with the root's packages, the bins it runs and the config's `lint.skip` entries. */
export type Turn = {
  root: string;
  changes: readonly Change[];
  packages: readonly string[];
  bins: Bins;
  skips: readonly LintSkip[];
};

export type StepResult = { label: string; ok: boolean; output: string[]; touched: string[] };

/** A step; null when its inputs did not change. */
export type Step = (turn: Turn) => StepResult | null;

const TESTS_LINE = /^\s*Tests\s+(.*)$/m;
const FAILED_COUNT = /(\d+) failed/;
const PASSED_COUNT = /(\d+) passed/;
const TOTAL_COUNT = /\((\d+)\)/;

/** Rust sources: no oxlint, only the script checks (the lexer rules; clippy compiles, so `repo check` runs it). */
const RUST_SOURCE = /\.rs$/;

function gated(rel: string): boolean {
  return LINTABLE.test(rel) || RUST_SOURCE.test(rel) || isLintedCss(rel);
}

const BIN = /* @__PURE__ */ path.join(import.meta.dirname, "../../bin/repo.ts");

/** The changed files to read as text: not deleted, and not a symlink, whose target may be a directory. */
function present(turn: Turn) {
  return turn.changes
    .filter((change) => !change.deleted && !fs.lstatSync(path.join(turn.root, change.rel)).isSymbolicLink())
    .map((change) => change.rel);
}

function text(root: string, rel: string) {
  return fs.readFileSync(path.join(root, rel), { encoding: "utf8", flag: "r" });
}

export function passed(label: string, touched: string[] = []): StepResult {
  return { label, ok: true, output: [], touched };
}

export function failed(label: string, output: string[], touched: string[] = []): StepResult {
  return {
    label,
    ok: false,
    output,
    touched,
  };
}

/** The files of `files` whose text a tool rewrote between this call and the returned one. */
function watch(root: string, files: readonly string[]): () => string[] {
  const before = new Map(files.map((rel) => [rel, text(root, rel)]));

  return () => files.filter((rel) => text(root, rel) !== before.get(rel));
}

export function fmtStep(turn: Turn): StepResult {
  const files = present(turn);

  if (files.length === 0) return passed("fmt ok");
  const rewritten = watch(turn.root, files);
  const run = captureSorted(files, turn.root);
  const touched = rewritten();

  if (run.code !== 0) return failed("fmt failed", [`${run.stdout}${run.stderr}`], touched);

  return passed(touched.length === 0 ? "fmt ok" : `fmt ${touched.length} fixed`, touched);
}

/** The lint lines of each excess's rule in its file, then what to do about it. */
function overOutput(over: readonly Excess[], diagnostics: readonly Diagnostic[]): string[] {
  const lines = diagnostics
    .filter((d) => over.some((e) => e.file === d.file && e.rule === d.rule))
    .map((d) => `${d.line}\n`);

  const fixes = over.map((e) => {
    const added = e.has - e.allows;

    return `repo turn: ${excessText(e)}; fix the ${added === 1 ? "new one" : `${added} new ones`}\n`;
  });

  return [...lines, ...fixes];
}

/**
 * Stylelint's fix on the stylesheets, `lint --fix -f json` on the lintable files until a pass rewrites none, then
 * oxfmt on what a fix rewrote.
 */
function lintFix(root: string, files: readonly string[]) {
  const rewritten = watch(root, files);
  cssDiagnostics(root, files, { fix: true });
  const lintable = files.filter((rel) => LINTABLE.test(rel));

  const report =
    lintable.length > 0
      ? fixPasses(root, lintable, () => lintReport(root, ["--fix", ...lintable]))
      : { ok: true as const, value: [] };

  const fixed = rewritten();

  if (fixed.length > 0) captureTool("oxfmt", fixed, root);

  return { fixed, report };
}

/**
 * oxlint's `report` with the script hits of `files` after it, those a `lint.skip` entry turns off left out. The hits
 * include the guards of sources a changed test imports, which may lie outside `files`; a clone's other side is looked
 * for in every source of the checkout.
 */
function withScripts(turn: Turn, files: readonly string[], report: Result<Diagnostic[]>): Result<Diagnostic[]> {
  const listed = report.ok ? sourceFiles(turn.root) : report;
  const scripts = listed.ok ? scriptDiagnostics(turn.root, { files, sources: listed.files }) : listed;

  if (!report.ok || !scripts.ok) return scripts;
  const reported = [...new Set([...files, ...scripts.value.map((d) => d.file)])];

  return { ok: true, value: [...report.value, ...withoutSkipped(scripts.value, turn.skips, reported)] };
}

/**
 * The excesses of the files outside the change set a changed test re-checked: only their script hits are known, so
 * they can fail the turn but never lower the baseline.
 */
function outsideOver(baseline: Baseline, diagnostics: readonly Diagnostic[], linted: readonly string[]): Excess[] {
  const outside = diagnostics.filter((d) => !linted.includes(d.file));
  const files = [...new Set(outside.map((d) => d.file))];

  return gate(baseline, countsOf(outside), files).over;
}

/**
 * Stylelint's and oxlint's fixes, the script checks on the lintable files, stylesheets and Rust sources, then the
 * baseline gate over those and the deleted ones.
 */
export function lintStep(turn: Turn): StepResult {
  const { report: oxlint, fixed } = lintFix(turn.root, present(turn).filter(gated));
  const report = withScripts(turn, present(turn).filter(gated), oxlint);
  const baseline = readBaseline(turn.root);

  if (!report.ok || !baseline.ok) {
    const errors = [report, baseline].flatMap((read) => (read.ok ? [] : read.errors));
    const output = errors.map((line) => `repo turn: ${line}\n`);

    return failed("lint failed", output, fixed);
  }

  const linted = turn.changes.filter((change) => change.deleted || gated(change.rel)).map((change) => change.rel);
  const result = gate(baseline.value, countsOf(report.value), linted);

  if (result.lowered.length > 0) writeBaseline(turn.root, result.next);
  const touched = result.lowered.length > 0 ? [...fixed, BASELINE_PATH] : fixed;
  const over = [...result.over, ...outsideOver(baseline.value, report.value, linted)];

  if (over.length > 0) {
    let count = 0;

    for (const e of over) count += e.has - e.allows;

    return failed(`lint ${count} over baseline`, overOutput(over, report.value), touched);
  }

  const lowered = result.lowered.map((l) => `${l.file} ${l.rule} ${l.from} → ${l.to}`).join(", ");

  return passed(lowered === "" ? "lint ok" : `lint ok, baseline lowered (${lowered})`, touched);
}

export function owners(turn: Turn): string[] {
  return [...new Set(turn.changes.map((change) => change.owner))].toSorted(byCodeUnit);
}

export function dirName(owner: string): string {
  return owner === "" ? "." : owner;
}

export type Counts = { passed: number; failed: number; total: number };

/** vitest's `Tests  1 failed | 3 passed (4)` line, read from its default reporter. */
export function countsOfRun(run: Captured): Counts {
  const line = TESTS_LINE.exec(run.stdout)?.[1] ?? "";

  function number(pattern: RegExp) {
    return Number(pattern.exec(line)?.[1] ?? 0);
  }

  return { failed: number(FAILED_COUNT), passed: number(PASSED_COUNT), total: number(TOTAL_COUNT) };
}

function isManifest(turn: Turn, rel: string) {
  return rel === MANIFEST_FILE || turn.packages.some((dir) => rel === `${dir}/${MANIFEST_FILE}`);
}

/**
 * Sync reads `.repo/` (but not the baseline, which turn itself writes), `references/`, the manifests and the
 * config.
 */
function syncReads(turn: Turn, rel: string): boolean {
  const repoDir = rel.startsWith(".repo/") && rel !== BASELINE_PATH;

  return repoDir || rel.startsWith("references/") || isManifest(turn, rel) || rel === CONFIG_FILE;
}

/** Check holds the manifests, lockfiles, `bunfig.toml`, the config and every tracked file sync writes. */
function checkReads(turn: Turn, rel: string, outputs: ReadonlySet<string>): boolean {
  const named = LOCKFILES.has(path.posix.basename(rel)) || rel === BUNFIG_FILE || rel === CONFIG_FILE;

  return named || isManifest(turn, rel) || outputs.has(rel);
}

/** What git stores for `rel` now: a symlink's target (never followed, it may be a directory), else its text. */
function content(root: string, rel: string): string | null {
  const full = path.join(root, rel);
  const link = fs.lstatSync(full, { throwIfNoEntry: false })?.isSymbolicLink();

  if (link === undefined) return null;

  return link ? fs.readlinkSync(full) : text(root, rel);
}

/** What `git add -A` would stage now, each with its text (null when deleted). */
function dirty(root: string): Map<string, string | null> {
  function git(args: string[]) {
    return spawnSync("git", [...args, "-z"], { cwd: root, encoding: "utf8" })
      .stdout.split("\0")
      .filter(Boolean);
  }

  const rels = [...git(["diff", "--name-only"]), ...git(["ls-files", "--others", "--exclude-standard"])];

  return new Map(rels.map((rel) => [rel, content(root, rel)]));
}

/** `repo sync` in the root, and the files it changed that git would stage. */
function sync(root: string) {
  const before = dirty(root);
  const run = captureBun([BIN, "sync"], root);
  const after = dirty(root);

  return { run, touched: [...after].filter(([rel, now]) => before.get(rel) !== now).map(([rel]) => rel) };
}

/** `repo sync` when a file it reads changed; the files it rewrote are restaged under `--staged`. */
export function syncStep(turn: Turn): StepResult | null {
  if (!turn.changes.some((change) => syncReads(turn, change.rel))) return null;
  const { run, touched } = sync(turn.root);

  return run.code === 0 ? passed("sync ok", touched) : failed("sync failed", [`${run.stdout}${run.stderr}`], touched);
}

/** `repo check` when a file it holds changed. */
export function checkStep(turn: Turn): StepResult | null {
  const outputs = new Set(readManifest(turn.root).paths);

  if (!turn.changes.some((change) => checkReads(turn, change.rel, outputs))) return null;
  const run = captureBun([BIN, "check"], turn.root);

  return run.code === 0 ? passed("check ok") : failed("check failed", [`${run.stdout}${run.stderr}`]);
}
