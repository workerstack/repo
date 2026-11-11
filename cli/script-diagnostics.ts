/**
 * The checks run as scripts on the TypeScript compiler API, joined for `repo check`, `repo turn`, `repo lint
 * --baseline` and, on the paths given or the whole repo, plain `repo lint`: the magic literals and the untested guards
 * as lint diagnostics the baseline counts, and the reject files check prints. Apart from `check-magic.ts` and
 * `check-guards.ts`, which this imports, so neither imports the other.
 */
import path from "node:path";
import { sourceFiles } from "./check-comments.ts";
import { guardDiagnostics } from "./guard-diagnostics.ts";
import { magicDiagnostics, withoutSkipped } from "./check-magic.ts";
import { rejectionProblems } from "./check-rejections.ts";
import { rustHitsAt, rustSourceDiagnostics, rustSources, type RustOptions } from "./rust/rust-hits.ts";
import type { CargoRun } from "./rust/clippy.ts";
import { RUST_SOURCE } from "./rust/rust-hits.constants.ts";
import { findRoot, loadConfig, type LintSkip } from "./config.ts";
import type { Diagnostic, Result } from "./scripts/lint-baseline.ts";

/** `repo check`'s script hits: all of them for the skip report, those no skip turns off for the baseline. */
export type ScriptCheck = { all: Diagnostic[]; kept: Diagnostic[]; problems: string[] };
/** A standards checkout's root, `lint.skip` and source files; null without a config or the pack. */
type Checkout = { root: string; skips: readonly LintSkip[]; files: Result<string[]>; rust: string[] } | null;

const NONE: ScriptCheck = { all: [], kept: [], problems: [] };

const byKey = (a: string, b: string) => Number(a > b) - Number(a < b);
/** File order, then line and column: within one file the lines differ from the position on, read as numbers. */
const byPlace = (a: Diagnostic, b: Diagnostic): number =>
  byKey(a.file, b.file) || a.line.localeCompare(b.line, "en", { numeric: true });

/**
 * The magic hits and untested guards of `files` (root-relative POSIX paths), in file then position order; the guards
 * of the sources a test among them imports too; and the Rust source rules (never clippy, which compiles) on the `.rs`
 * files among them, in a repo with a root Cargo.toml. Or why a tsconfig.json could not be read.
 */
export function scriptDiagnostics(root: string, files: readonly string[]): Result<Diagnostic[]> {
  const magic = magicDiagnostics(root, files);
  if (!magic.ok) return magic;
  const guards = guardDiagnostics(root, files);
  if (!guards.ok) return guards;
  const rust = rustSourceDiagnostics(
    root,
    files.filter((rel) => RUST_SOURCE.test(rel)),
  );
  return { ok: true, value: [...magic.value, ...guards.value, ...rust].sort(byPlace) };
}

/** The checkout's script diagnostics: those of its JS/TS `files`, then the Rust ones with clippy (a root Cargo.toml). */
function allDiagnostics(checkout: NonNullable<Checkout>, files: readonly string[], run?: CargoRun) {
  const found = scriptDiagnostics(checkout.root, files);
  if (!found.ok) return found;
  const rust = rustHitsAt(checkout.root, checkout.rust, { clippy: true, run });
  return rust.ok ? { ok: true as const, value: [...found.value, ...rust.value].sort(byPlace) } : rust;
}

async function checkoutAt(cwd: string): Promise<Checkout> {
  const root = findRoot(cwd);
  if (root === null) return null;
  const loaded = await loadConfig(root);
  if (!loaded.ok || !loaded.config.packs.includes("standards")) return null;
  const rust = rustSources(root);
  const listed = rust.ok ? sourceFiles(root) : rust;
  const files: Result<string[]> = listed.ok ? { ok: true, value: listed.files } : listed;
  return { root, skips: loaded.config.lint.skip, files, rust: rust.ok ? rust.files : [] };
}

/** `repo check`'s script hits for the repo at `cwd`: none without a config or the standards pack. */
export async function checkScriptsAt(cwd: string, run?: CargoRun): Promise<ScriptCheck> {
  const checkout = await checkoutAt(cwd);
  if (checkout === null) return NONE;
  if (!checkout.files.ok) return { ...NONE, problems: checkout.files.errors };
  const found = allDiagnostics(checkout, checkout.files.value, run);
  if (!found.ok) return { ...NONE, problems: found.errors };
  const matched = [...checkout.files.value, ...checkout.rust];
  return { all: found.value, kept: withoutSkipped(found.value, checkout.skips, matched), problems: [] };
}

/** What `repo lint` checks: `paths` as given at the cwd (null: the whole checkout), and whether clippy runs too. */
export type LintScope = { paths: readonly string[] | null; clippy: boolean };
/** What `repo lint` prints of the script checks: the hit lines no skip turns off, and why it could not check. */
export type ScriptLint = { lines: string[]; problems: string[] };

/** The `all` files that equal one of `paths` (given at `cwd`, root-relative to `root`) or lie under one. */
function filesUnder(at: { root: string; cwd: string }, paths: readonly string[], all: readonly string[]): string[] {
  const given = paths.map((p) => path.relative(at.root, path.resolve(at.cwd, p)).split(path.sep).join("/"));
  return all.filter((rel) => given.some((g) => g === "" || rel === g || rel.startsWith(`${g}/`)));
}

/** The script hits of `files`: magic and guards on the JS/TS ones, the Rust source rules (and clippy) on the `.rs`. */
function lintHits(checkout: NonNullable<Checkout>, files: readonly string[], options: RustOptions) {
  const found = scriptDiagnostics(
    checkout.root,
    files.filter((rel) => !RUST_SOURCE.test(rel)),
  );
  if (!found.ok) return found;
  const rust = rustHitsAt(
    checkout.root,
    files.filter((rel) => RUST_SOURCE.test(rel)),
    options,
  );
  return rust.ok ? { ok: true as const, value: [...found.value, ...rust.value].toSorted(byPlace) } : rust;
}

/**
 * `repo lint`'s script hits for the repo at `cwd`: the magic literals, untested guards and Rust source rules of the
 * files `scope.paths` names (a directory: every source file under it; null: the whole checkout), and with
 * `scope.clippy` clippy's too. Nothing without a config or the standards pack.
 */
export async function scriptLintAt(cwd: string, scope: LintScope, run?: CargoRun): Promise<ScriptLint> {
  const checkout = await checkoutAt(cwd);
  if (checkout === null) return { lines: [], problems: [] };
  if (!checkout.files.ok) return { lines: [], problems: checkout.files.errors };
  const all = [...checkout.files.value, ...checkout.rust];
  const files = scope.paths === null ? all : filesUnder({ root: checkout.root, cwd }, scope.paths, all);
  const found = lintHits(checkout, files, { clippy: scope.clippy, run });
  if (!found.ok) return { lines: [], problems: found.errors };
  const matched = [...files, ...found.value.map((d) => d.file)];
  return { lines: withoutSkipped(found.value, checkout.skips, matched).map((d) => d.line), problems: [] };
}

/** `repo check`'s reject file problems for the repo at `cwd`: none without a config or the standards pack. */
export async function checkRejectionsAt(cwd: string): Promise<string[]> {
  const checkout = await checkoutAt(cwd);
  if (checkout === null) return [];
  return checkout.files.ok ? rejectionProblems(checkout.root, checkout.files.value) : checkout.files.errors;
}
