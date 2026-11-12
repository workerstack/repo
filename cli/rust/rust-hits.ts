import fs from "node:fs";
import path from "node:path";

import type { Listed } from "../check-comments.ts";
import { codeOf } from "../lint/script-rules.ts";
import type { Diagnostic, Result } from "../scripts/lint-baseline.ts";
import { byCodeUnit } from "../sync/by-code-unit.ts";
import { runGit } from "../sync/standards.ts";
import { clippyHits, runCargo, type CargoRun } from "./clippy.ts";
import { CARGO_MANIFEST, EXCLUDED_DIRS, RUST_SOURCE } from "./rust-hits.constants.ts";
import { rustSourceHits, type RustHit } from "./source-checks.ts";

/** What `rustHitsAt` runs: clippy when `clippy` is set (it compiles the crate), through `run` when given. */
export type RustOptions = { clippy: boolean; run?: CargoRun | undefined };

function isRust(rel: string) {
  return RUST_SOURCE.test(rel) && !rel.split("/").some((part) => EXCLUDED_DIRS.includes(part));
}

/**
 * The tracked and untracked, not ignored, `.rs` files under `root`, outside any `__fixtures__` or `target` dir,
 * sorted.
 */
export function rustFiles(root: string): Listed {
  const run = runGit(root, ["ls-files", "-z", "--cached", "--others", "--exclude-standard"]);

  if (run.status !== 0) return { errors: [`git ls-files failed: ${run.stderr.trim()}`], ok: false };

  return { files: [...new Set(run.stdout.split("\0").filter(isRust))].toSorted(byCodeUnit), ok: true };
}

/**
 * `rustFiles`, or none when `root` has no Cargo.toml: the checks list Rust only for a Rust repo, and spawn no git for
 * another.
 */
export function rustSources(root: string): Listed {
  return fs.existsSync(path.join(root, CARGO_MANIFEST)) ? rustFiles(root) : { files: [], ok: true };
}

function byPlace(a: RustHit, b: RustHit) {
  if (a.file !== b.file) return byCodeUnit(a.file, b.file);

  return a.line === b.line ? a.column - b.column : a.line - b.line;
}

/** A hit as the diagnostic `repo lint` prints: `file:line:col: error rule: message`. */
function diagnosticOf(hit: RustHit): Diagnostic {
  const rule = codeOf(hit.rule);

  return { file: hit.file, line: `${hit.file}:${hit.line}:${hit.column}: error ${rule}: ${hit.message}`, rule };
}

function isRustRepo(root: string) {
  return fs.existsSync(path.join(root, CARGO_MANIFEST));
}

/** The source rules' hits in those of `files` that exist, and those files. */
function sourceHitsOf(root: string, files: readonly string[]) {
  const present = files.filter((rel) => fs.existsSync(path.join(root, rel)));

  return {
    hits: present.flatMap((rel) => rustSourceHits(rel, fs.readFileSync(path.join(root, rel), "utf8"))),
    present,
  };
}

/**
 * The three source rules' diagnostics of `files` (never clippy, so nothing compiles); none without a root Cargo.toml.
 */
export function rustSourceDiagnostics(root: string, files: readonly string[]): Diagnostic[] {
  return isRustRepo(root) ? sourceHitsOf(root, files).hits.toSorted(byPlace).map(diagnosticOf) : [];
}

/**
 * The Rust diagnostics of `files` (root-relative POSIX paths): the three source rules on each file that exists, and
 * clippy's and rustc's hits in those files when `options.clippy` is set. Only a repo with a root `Cargo.toml` has any;
 * a failed clippy run is the problems alone, since the code was not linted.
 */
export function rustHitsAt(root: string, files: readonly string[], options: RustOptions): Result<Diagnostic[]> {
  if (!isRustRepo(root)) return { ok: true, value: [] };
  const { present, hits } = sourceHitsOf(root, files);

  if (options.clippy) {
    const linted = clippyHits(root, options.run ?? runCargo);

    if (!linted.ok) return linted;
    const known = new Set(present);
    hits.push(...linted.value.filter((hit) => known.has(hit.file)));
  }

  return { ok: true, value: hits.toSorted(byPlace).map(diagnosticOf) };
}
