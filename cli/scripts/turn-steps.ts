/**
 * The steps of `repo turn`, each over the change set: fmt, lint with the baseline gate, typecheck, related tests,
 * then sync and check when their inputs changed. A step reports a summary label, whether it passed, the tool output
 * to print when it failed, and the files it rewrote, which `--staged` restages.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { magicDiagnostics, withoutSkipped } from "../check-magic.ts";
import { CONFIG_FILE, type LintSkip } from "../config.ts";
import { readManifest } from "../sync/manifest.ts";
import type { Change } from "./change-set.ts";
import { captureBun, captureTool, type Captured } from "./lint.ts";
import {
  BASELINE_PATH,
  countsOf,
  excessText,
  gate,
  lintReport,
  readBaseline,
  writeBaseline,
  type Diagnostic,
  type Excess,
  type Result,
} from "./lint-baseline.ts";

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

const LINTABLE = /\.(?:[cm]?[jt]sx?|vue|astro|svelte)$/;
const LOCKFILES = new Set(["bun.lock", "bun.lockb", "package-lock.json", "yarn.lock", "pnpm-lock.yaml"]);
const BIN = path.join(import.meta.dirname, "../../bin/repo.ts");

const present = (turn: Turn) => turn.changes.filter((change) => !change.deleted).map((change) => change.rel);
const text = (root: string, rel: string) => fs.readFileSync(path.join(root, rel), { encoding: "utf8", flag: "r" });
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const passed = (label: string, touched: string[] = []): StepResult => ({ label, ok: true, output: [], touched });
const failed = (label: string, output: string[], touched: string[] = []): StepResult => ({
  label,
  ok: false,
  output,
  touched,
});

/** The files of `files` whose text a tool rewrote between this call and the returned one. */
function watch(root: string, files: readonly string[]): () => string[] {
  const before = new Map(files.map((rel) => [rel, text(root, rel)]));
  return () => files.filter((rel) => text(root, rel) !== before.get(rel));
}

export const fmtStep: Step = (turn) => {
  const files = present(turn);
  if (files.length === 0) return passed("fmt ok");
  const rewritten = watch(turn.root, files);
  const run = captureTool("oxfmt", ["--no-error-on-unmatched-pattern", ...files], turn.root);
  const touched = rewritten();
  if (run.code !== 0) return failed("fmt failed", [`${run.stdout}${run.stderr}`], touched);
  return passed(touched.length === 0 ? "fmt ok" : `fmt ${touched.length} fixed`, touched);
};

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

/** `lint --fix -f json` on `files`, then oxfmt on any file the fix rewrote. */
function lintFix(root: string, files: readonly string[]): { report: Result<Diagnostic[]>; fixed: string[] } {
  if (files.length === 0) return { report: { ok: true, value: [] }, fixed: [] };
  const rewritten = watch(root, files);
  const report = lintReport(root, ["--fix", ...files]);
  const fixed = rewritten();
  if (fixed.length > 0) captureTool("oxfmt", fixed, root);
  return { report, fixed };
}

/** oxlint's `report` with the magic hits of `files` after it, those a `lint.skip` entry turns off left out. */
function withMagic(turn: Turn, files: readonly string[], report: Result<Diagnostic[]>): Result<Diagnostic[]> {
  const magic = report.ok ? magicDiagnostics(turn.root, files) : report;
  if (!report.ok || !magic.ok) return magic;
  return { ok: true, value: [...report.value, ...withoutSkipped(magic.value, turn.skips, files)] };
}

/** `lint --fix` on the lintable files, then the baseline gate over them and the deleted ones. */
export const lintStep: Step = (turn) => {
  const files = present(turn).filter((rel) => LINTABLE.test(rel));
  const { report: oxlint, fixed } = lintFix(turn.root, files);
  const report = withMagic(turn, files, oxlint);
  const baseline = readBaseline(turn.root);
  if (!report.ok || !baseline.ok) {
    const errors = [report, baseline].flatMap((read) => (read.ok ? [] : read.errors));
    return failed(
      "lint failed",
      errors.map((line) => `repo turn: ${line}\n`),
      fixed,
    );
  }
  const linted = turn.changes.filter((change) => change.deleted || LINTABLE.test(change.rel));
  const result = gate(
    baseline.value,
    countsOf(report.value),
    linted.map((change) => change.rel),
  );
  if (result.lowered.length > 0) writeBaseline(turn.root, result.next);
  const touched = result.lowered.length > 0 ? [...fixed, BASELINE_PATH] : fixed;
  if (result.over.length > 0) {
    const count = result.over.reduce((sum, e) => sum + e.has - e.allows, 0);
    return failed(`lint ${count} over baseline`, overOutput(result.over, report.value), touched);
  }
  const lowered = result.lowered.map((l) => `${l.file} ${l.rule} ${l.from} → ${l.to}`).join(", ");
  return passed(lowered === "" ? "lint ok" : `lint ok, baseline lowered (${lowered})`, touched);
};

const owners = (turn: Turn) => [...new Set(turn.changes.map((change) => change.owner))].sort();
const dirName = (owner: string) => owner || ".";

/** `tsc --noEmit -p` for each owning package with a tsconfig.json, the root for files outside packages. */
export const typecheckStep: Step = (turn) => {
  const checked = owners(turn).filter((owner) => fs.existsSync(path.join(turn.root, owner, "tsconfig.json")));
  if (checked.length === 0) return passed("typecheck skipped (no tsconfig.json)");
  const runs = checked.map((owner) => ({ owner, run: turn.bins.tsc(["--noEmit", "-p", dirName(owner)], turn.root) }));
  const bad = runs.filter(({ run }) => run.code !== 0);
  if (bad.length === 0) return passed(`typecheck ${checked.map(dirName).join(", ")}`);
  const output = bad.map(({ run }) => `${run.stdout}${run.stderr}`);
  return failed(`typecheck failed (${bad.map(({ owner }) => dirName(owner)).join(", ")})`, output);
};

type Counts = { passed: number; failed: number; total: number };

/** vitest's `Tests  1 failed | 3 passed (4)` line, read from its default reporter. */
function countsOfRun(run: Captured): Counts {
  const line = /^\s*Tests\s+(.*)$/m.exec(run.stdout)?.[1] ?? "";
  const number = (pattern: RegExp) => Number(pattern.exec(line)?.[1] ?? 0);
  return { passed: number(/(\d+) passed/), failed: number(/(\d+) failed/), total: number(/\((\d+)\)/) };
}

function testsLabel(counts: Counts, skipped: readonly string[], broke: boolean): string {
  const none = skipped.length > 0 ? ` (no vitest in ${skipped.join(", ")})` : "";
  if (counts.failed > 0) return `${plural(counts.total, "related test")}, ${counts.failed} failed${none}`;
  if (broke) return `related tests failed${none}`;
  if (counts.passed > 0) return `${plural(counts.passed, "related test")} passed${none}`;
  return none === "" || counts.total > 0 ? `0 related tests${none}` : `related tests skipped${none}`;
}

/** One `vitest related --run` per owning package on its changed code files; null where vitest is not installed. */
function relatedRuns(turn: Turn): { owner: string; run: Captured | null }[] {
  return owners(turn).flatMap((owner) => {
    const own = turn.changes
      .filter((change) => !change.deleted && change.owner === owner && LINTABLE.test(change.rel))
      .map((change) => path.posix.relative(owner, change.rel));
    if (own.length === 0) return [];
    const args = ["related", "--run", "--passWithNoTests", ...own];
    return [{ owner, run: turn.bins.vitest(args, path.join(turn.root, owner)) }];
  });
}

export const testsStep: Step = (turn) => {
  const runs = relatedRuns(turn);
  const skipped = runs.filter(({ run }) => run === null).map(({ owner }) => dirName(owner));
  const ran = runs.flatMap(({ run }) => (run === null ? [] : [run]));
  const counts = ran.map(countsOfRun).reduce(
    (sum, next) => ({
      passed: sum.passed + next.passed,
      failed: sum.failed + next.failed,
      total: sum.total + next.total,
    }),
    { passed: 0, failed: 0, total: 0 },
  );
  const bad = ran.filter((run) => run.code !== 0);
  const label = testsLabel(counts, skipped, bad.length > 0);
  return bad.length === 0
    ? passed(label)
    : failed(
        label,
        bad.map((run) => `${run.stdout}${run.stderr}`),
      );
};

const isManifest = (turn: Turn, rel: string) =>
  rel === "package.json" || turn.packages.some((dir) => rel === `${dir}/package.json`);

/** Sync reads `.repo/` (but not the baseline, which turn itself writes), `references/`, the manifests and the config. */
function syncReads(turn: Turn, rel: string): boolean {
  const repoDir = rel.startsWith(".repo/") && rel !== BASELINE_PATH;
  return repoDir || rel.startsWith("references/") || isManifest(turn, rel) || rel === CONFIG_FILE;
}

/** Check holds the manifests, lockfiles, `bunfig.toml`, the config and every tracked file sync writes. */
function checkReads(turn: Turn, rel: string, outputs: ReadonlySet<string>): boolean {
  const named = LOCKFILES.has(path.posix.basename(rel)) || rel === "bunfig.toml" || rel === CONFIG_FILE;
  return named || isManifest(turn, rel) || outputs.has(rel);
}

/** What `git add -A` would stage now, each with its text (null when deleted). */
function dirty(root: string): Map<string, string | null> {
  const git = (args: string[]) =>
    spawnSync("git", [...args, "-z"], { cwd: root, encoding: "utf8" })
      .stdout.split("\0")
      .filter(Boolean);
  const rels = [...git(["diff", "--name-only"]), ...git(["ls-files", "--others", "--exclude-standard"])];
  return new Map(rels.map((rel) => [rel, fs.existsSync(path.join(root, rel)) ? text(root, rel) : null]));
}

/** `repo sync` in the root, and the files it changed that git would stage. */
function sync(root: string): { run: Captured; touched: string[] } {
  const before = dirty(root);
  const run = captureBun([BIN, "sync"], root);
  const after = dirty(root);
  return { run, touched: [...after].filter(([rel, now]) => before.get(rel) !== now).map(([rel]) => rel) };
}

/** `repo sync` when a file it reads changed; the files it rewrote are restaged under `--staged`. */
export const syncStep: Step = (turn) => {
  if (!turn.changes.some((change) => syncReads(turn, change.rel))) return null;
  const { run, touched } = sync(turn.root);
  return run.code === 0 ? passed("sync ok", touched) : failed("sync failed", [`${run.stdout}${run.stderr}`], touched);
};

/** `repo check` when a file it holds changed. */
export const checkStep: Step = (turn) => {
  const outputs = new Set(readManifest(turn.root).paths);
  if (!turn.changes.some((change) => checkReads(turn, change.rel, outputs))) return null;
  const run = captureBun([BIN, "check"], turn.root);
  return run.code === 0 ? passed("check ok") : failed("check failed", [`${run.stdout}${run.stderr}`]);
};
