/**
 * The checks run as scripts on the TypeScript compiler API, joined for `repo check`, `repo turn` and `repo lint
 * --baseline`: the magic literals and the untested guards as lint diagnostics the baseline counts, and the reject files
 * check prints. Apart from `check-magic.ts` and `check-guards.ts`, which this imports, so neither imports the other.
 */
import { sourceFiles } from "./check-comments.ts";
import { guardDiagnostics } from "./guard-diagnostics.ts";
import { magicDiagnostics, withoutSkipped } from "./check-magic.ts";
import { rejectionProblems } from "./check-rejections.ts";
import { findRoot, loadConfig, type LintSkip } from "./config.ts";
import type { Diagnostic, Result } from "./scripts/lint-baseline.ts";

/** `repo check`'s script hits: all of them for the skip report, those no skip turns off for the baseline. */
export type ScriptCheck = { all: Diagnostic[]; kept: Diagnostic[]; problems: string[] };
/** A standards checkout's root, `lint.skip` and source files; null without a config or the pack. */
type Checkout = { root: string; skips: readonly LintSkip[]; files: Result<string[]> } | null;

const NONE: ScriptCheck = { all: [], kept: [], problems: [] };

const byKey = (a: string, b: string) => Number(a > b) - Number(a < b);
/** File order, then line and column: within one file the lines differ from the position on, read as numbers. */
const byPlace = (a: Diagnostic, b: Diagnostic): number =>
  byKey(a.file, b.file) || a.line.localeCompare(b.line, "en", { numeric: true });

/**
 * The magic hits and untested guards of `files` (root-relative POSIX paths), in file then position order; the guards
 * of the sources a test among them imports too. Or why a tsconfig.json could not be read.
 */
export function scriptDiagnostics(root: string, files: readonly string[]): Result<Diagnostic[]> {
  const magic = magicDiagnostics(root, files);
  if (!magic.ok) return magic;
  const guards = guardDiagnostics(root, files);
  if (!guards.ok) return guards;
  return { ok: true, value: [...magic.value, ...guards.value].sort(byPlace) };
}

async function checkoutAt(cwd: string): Promise<Checkout> {
  const root = findRoot(cwd);
  if (root === null) return null;
  const loaded = await loadConfig(root);
  if (!loaded.ok || !loaded.config.packs.includes("standards")) return null;
  const listed = sourceFiles(root);
  const files: Result<string[]> = listed.ok ? { ok: true, value: listed.files } : listed;
  return { root, skips: loaded.config.lint.skip, files };
}

/** `repo check`'s script hits for the repo at `cwd`: none without a config or the standards pack. */
export async function checkScriptsAt(cwd: string): Promise<ScriptCheck> {
  const checkout = await checkoutAt(cwd);
  if (checkout === null) return NONE;
  if (!checkout.files.ok) return { ...NONE, problems: checkout.files.errors };
  const found = scriptDiagnostics(checkout.root, checkout.files.value);
  if (!found.ok) return { ...NONE, problems: found.errors };
  return { all: found.value, kept: withoutSkipped(found.value, checkout.skips, checkout.files.value), problems: [] };
}

/** `repo check`'s reject file problems for the repo at `cwd`: none without a config or the standards pack. */
export async function checkRejectionsAt(cwd: string): Promise<string[]> {
  const checkout = await checkoutAt(cwd);
  if (checkout === null) return [];
  return checkout.files.ok ? rejectionProblems(checkout.root, checkout.files.value) : checkout.files.errors;
}
