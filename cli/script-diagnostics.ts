/**
 * The checks run as scripts on the TypeScript compiler API, joined for `repo check`, `repo turn` and `repo lint
 * --baseline`: the magic literals and the untested guards as lint diagnostics the baseline counts, and the reject files
 * check prints. Apart from `check-magic.ts` and `check-guards.ts`, which this imports, so neither imports the other.
 */
import path from "node:path";
import { sourceFiles } from "./check-comments.ts";
import { guardDiagnostics } from "./guard-diagnostics.ts";
import { magicDiagnostics, withoutSkipped } from "./check-magic.ts";
import { rejectionProblems } from "./check-rejections.ts";
import { rustHitsAt, rustSourceDiagnostics, rustSources } from "./rust/rust-hits.ts";
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

/** What `repo lint` prints of Rust: the hit lines no skip turns off, and why it could not lint. */
export type RustLint = { lines: string[]; problems: string[] };

/**
 * `repo lint`'s Rust hits for the repo at `cwd`. With `paths` (as given at `cwd`) only the source rules run, on those
 * of them that are `.rs` files; with null the whole repo is linted, clippy included. Nothing without a config, the
 * standards pack or a root Cargo.toml.
 */
export async function rustLintAt(cwd: string, paths: readonly string[] | null, run?: CargoRun): Promise<RustLint> {
  const checkout = await checkoutAt(cwd);
  if (checkout === null) return { lines: [], problems: [] };
  const given = (paths ?? []).map((p) => path.relative(checkout.root, path.resolve(cwd, p)).split(path.sep).join("/"));
  const files = paths === null ? checkout.rust : given.filter((rel) => RUST_SOURCE.test(rel));
  const found = rustHitsAt(checkout.root, files, { clippy: paths === null, run });
  if (!found.ok) return { lines: [], problems: found.errors };
  return { lines: withoutSkipped(found.value, checkout.skips, checkout.rust).map((d) => d.line), problems: [] };
}

/** `repo check`'s reject file problems for the repo at `cwd`: none without a config or the standards pack. */
export async function checkRejectionsAt(cwd: string): Promise<string[]> {
  const checkout = await checkoutAt(cwd);
  if (checkout === null) return [];
  return checkout.files.ok ? rejectionProblems(checkout.root, checkout.files.value) : checkout.files.errors;
}
