/**
 * The steps of `repo turn` and `repo precommit`, each over the change set: fmt, lint with the baseline gate (its fix
 * narrowed to the rules a file is over its baseline on), typecheck, sync when its inputs changed, related tests
 * (precommit only), then check. A step reports a summary label, whether it passed, the tool output to print when it
 * failed, and the files it rewrote, which precommit restages.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { sourceFiles } from "../check-comments.ts";
import { withoutSkipped } from "../check-magic.ts";
import { CONFIG_FILE } from "../config.constants.ts";
import { type LintSkip } from "../config.ts";
import { cssDiagnostics, isLintedCss } from "../css/css-diagnostics.ts";
import type { Result } from "../result.ts";
import { scriptDiagnostics } from "../script-diagnostics.ts";
import { byCodeUnit } from "../sync/by-code-unit.ts";
import { readManifest } from "../sync/manifest.ts";
import type { Change, Scope } from "./change-set.ts";
import { BASELINE_PATH } from "./lint-baseline.constants.ts";
import {
  countsOf,
  type Counts as Baseline,
  gate,
  lintReport,
  readBaseline,
  writeBaseline,
  type Diagnostic,
} from "./lint-baseline.ts";
import { fixOverBaseline } from "./lint-fix-config.ts";
import { outsideOver, overOutput } from "./lint-gate.ts";
import { captureBun, captureSorted, captureTool, type Captured } from "./lint.ts";
import { LINTABLE } from "./lintable.constants.ts";
import type { TestRun } from "./node-run.ts";
import { BUNFIG_FILE, LOCKFILES, MANIFEST_FILE } from "./turn-steps.constants.ts";

/**
 * typescript, a dependency, and vitest, an optional peer, as `run` of the package at `cwd`: null when that package
 * cannot resolve vitest.
 */
export type Bins = {
  tsc: (args: string[], cwd: string) => Promise<Captured>;
  vitest: (args: string[], cwd: string, run: TestRun) => Promise<Captured> | null;
};

/** The command that gates a change set, which names it in every line it prints. */
export type GateName = "turn" | "precommit";

/**
 * A change set to gate, with the command gating it, the root's packages, the bins it runs, the config's `lint.skip`
 * entries, and its scope; under the staged scope (precommit) the gate restages after each step.
 */
export type Turn = {
  command: GateName;
  root: string;
  changes: readonly Change[];
  packages: readonly string[];
  bins: Bins;
  skips: readonly LintSkip[];
  scope: Scope;
};

/** oxlint's or the script checks' diagnostics, or why they could not be had. */
type Report = Result<Diagnostic[]>;

export type StepResult = { label: string; ok: boolean; output: string[]; touched: string[] };

/** A step; null when its inputs did not change. */
export type Step = (turn: Turn) => Promise<StepResult | null>;

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

export async function fmtStep(turn: Turn): Promise<StepResult> {
  const files = present(turn);

  if (files.length === 0) return passed("fmt ok");
  const rewritten = watch(turn.root, files);
  const run = await captureSorted(files, turn.root);
  const touched = rewritten();

  if (run.code !== 0) return failed("fmt failed", [`${run.stdout}${run.stderr}`], touched);

  return passed(touched.length === 0 ? "fmt ok" : `fmt ${touched.length} fixed`, touched);
}

/** oxlint's report on `files`, or none to read when there are no files. */
async function oxlintReport(root: string, files: readonly string[]): Promise<Report> {
  return files.length > 0 ? await lintReport(root, files) : { ok: true, value: [] };
}

/**
 * Stylelint's fix on the stylesheets; oxlint's report on the lintable files, then its fix on each file over its
 * baseline with only the rules it is over on (`fixOverBaseline`), so a baselined hit stays as it is while an over rule
 * gets all its hits in that file fixed; bun fmt on what a fix rewrote. A baseline that could not be read runs no fix.
 */
async function lintFix(root: string, files: readonly string[], baseline: Result<Baseline>) {
  const lintable = files.filter((rel) => LINTABLE.test(rel));

  if (!baseline.ok) return { fixed: [], report: await oxlintReport(root, lintable) };
  const rewritten = watch(root, files);
  await cssDiagnostics(root, files, { fix: true });
  const first = await oxlintReport(root, lintable);
  const report = await fixOverBaseline(root, { baseline: baseline.value, files: lintable }, first);
  const fixed = rewritten();

  if (fixed.length > 0) await captureTool("bun fmt", fixed, { root });

  return { fixed, report };
}

/**
 * oxlint's `report` with the script hits of `files` after it, those a `lint.skip` entry turns off left out. The hits
 * include the guards of sources a changed test imports, which may lie outside `files`; a clone's other side is looked
 * for in every source of the checkout.
 */
async function withScripts(turn: Turn, files: readonly string[], report: Report): Promise<Report> {
  const listed = report.ok ? sourceFiles(turn.root) : report;
  const scripts = listed.ok ? await scriptDiagnostics(turn.root, { files, sources: listed.value }) : listed;

  if (!report.ok || !scripts.ok) return scripts;
  const reported = [...new Set([...files, ...scripts.value.map((d) => d.file)])];

  return { ok: true, value: [...report.value, ...withoutSkipped(scripts.value, turn.skips, reported)] };
}

/**
 * Stylelint's fix and oxlint's fix of the rules a file is over its baseline on, the script checks on the lintable
 * files, stylesheets and Rust sources, then the baseline gate over those and the deleted ones.
 */
export async function lintStep(turn: Turn): Promise<StepResult> {
  const baseline = readBaseline(turn.root);
  const { report: oxlint, fixed } = await lintFix(turn.root, present(turn).filter(gated), baseline);
  const report = await withScripts(turn, present(turn).filter(gated), oxlint);

  if (!report.ok || !baseline.ok) {
    const errors = [report, baseline].flatMap((read) => (read.ok ? [] : read.error));
    const output = errors.map((line) => `repo ${turn.command}: ${line}\n`);

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

    const { hits, fixes } = overOutput(turn.command, over, report.value);

    return failed(`lint ${count} over baseline`, [...hits, ...fixes], touched);
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

/** Check holds the manifests, lockfiles, every `bunfig.toml`, the config and every tracked file sync writes. */
function checkReads(turn: Turn, rel: string, outputs: ReadonlySet<string>): boolean {
  const base = path.posix.basename(rel);
  const named = LOCKFILES.has(base) || base === BUNFIG_FILE || rel === CONFIG_FILE;

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
async function sync(root: string) {
  const before = dirty(root);
  const run = await captureBun([BIN, "sync"], root);
  const after = dirty(root);

  return { run, touched: [...after].filter(([rel, now]) => before.get(rel) !== now).map(([rel]) => rel) };
}

/** `repo sync` when a file it reads changed; precommit restages the files it rewrote. */
export async function syncStep(turn: Turn): Promise<StepResult | null> {
  if (!turn.changes.some((change) => syncReads(turn, change.rel))) return null;
  const { run, touched } = await sync(turn.root);

  return run.code === 0 ? passed("sync ok", touched) : failed("sync failed", [`${run.stdout}${run.stderr}`], touched);
}

/** `repo check` when a file it holds changed. */
export async function checkStep(turn: Turn): Promise<StepResult | null> {
  const outputs = new Set(readManifest(turn.root).paths);

  if (!turn.changes.some((change) => checkReads(turn, change.rel, outputs))) return null;
  const run = await captureBun([BIN, "check"], turn.root);

  return run.code === 0 ? passed("check ok") : failed("check failed", [`${run.stdout}${run.stderr}`]);
}
