/**
 * `repo check`'s view of `lint.skip`: every skip with its rule, path, hits and reason, a count per rule, and the
 * entries gone stale. The hits come from one more lint of the skipped files under the generated config without its
 * skips, written beside `.oxlintrc.jsonc` for the run (oxlint reads override globs against the config's own dir) and
 * named for the process, so two checks never remove each other's copy.
 */
import fs from "node:fs";
import path from "node:path";

import { sourceFiles } from "../check-comments.ts";
import type { LintSkip, ResolvedLint } from "../config.ts";
import { cssFiles, isLintedCss } from "../css/css-diagnostics.ts";
import { codeOf } from "../lint/script-rules.ts";
import type { Result } from "../result.ts";
import { RUST_SOURCE } from "../rust/rust-hits.constants.ts";
import { rustSources } from "../rust/rust-hits.ts";
import { standardsWorkspace } from "../standards-workspace.ts";
import { oxlintConfig, unskippedConfigPath } from "../sync/oxlint-config.ts";
import { withTailwindEntry } from "../sync/tailwind-entry.ts";
import type { Workspace } from "../sync/workspace.ts";
import { type Diagnostic, lintReport } from "./lint-baseline.ts";
import { captureTool } from "./lint.ts";
import { ROOT_ANCHOR } from "./root-anchor.constants.ts";

/** What `repo check` prints of the skips: report lines that pass, problem lines that fail it. */
export type SkipCheck = { report: string[]; problems: string[] };

/** The script checks' hits, no skip applied, and the oxlint runner (`captureTool` unless a test injects another). */
export type SkipDeps = { scripts: readonly Diagnostic[]; run?: typeof captureTool };

/** The files the unskipped run lints, and the oxlint runner it lints them with. */
type Unskipped = { files: readonly string[]; run: typeof captureTool };

/** One `lint.skip` entry with the source files its globs match. */
type Matched = { skip: LintSkip; index: number; files: Set<string> };

const NONE: SkipCheck = { problems: [], report: [] };

function byKey(a: string, b: string) {
  return Number(a > b) - Number(a < b);
}

function hits(n: number) {
  return `${n} hit${n === 1 ? "" : "s"}`;
}

/**
 * oxlint's override match: a glob with no slash matches a file's name in any dir, a leading `./` anchors it at the
 * root, and any other glob matches the root-relative path.
 */
function matcherOf(glob: string): Bun.Glob {
  if (glob.startsWith(ROOT_ANCHOR)) return new Bun.Glob(glob.slice(ROOT_ANCHOR.length));

  return new Bun.Glob(glob.includes("/") ? glob : `**/${glob}`);
}

/** The `files` (root-relative POSIX paths) any of `globs` matches, as oxlint's overrides match them, in their order. */
export function skipFiles(globs: readonly string[], files: readonly string[]): string[] {
  const matchers = globs.map(matcherOf);

  return files.filter((file) => matchers.some((matcher) => matcher.match(file)));
}

function noFile(index: number, glob: string) {
  return `lint.skip[${index}]: ${JSON.stringify(glob)} matches no file; fix the path or delete the entry`;
}

function noHit({ skip, index }: Matched, rule: string) {
  const globs = skip.files.map((glob) => JSON.stringify(glob)).join(", ");

  return `lint.skip[${index}]: ${rule} has no hit in ${globs}; delete it from the entry`;
}

/** The diagnostics of `rule` in `files`. */
function hitsOf(diagnostics: readonly Diagnostic[], rule: string, files: ReadonlySet<string>) {
  return diagnostics.filter((d) => d.rule === codeOf(rule) && files.has(d.file));
}

/** Each entry's report lines, one per rule and glob with hits, and a problem per rule with none. */
function entryLines(entry: Matched, diagnostics: readonly Diagnostic[], sources: readonly string[]): SkipCheck {
  const { skip } = entry;
  const report: string[] = [];
  const problems: string[] = [];

  for (const rule of skip.rules) {
    if (hitsOf(diagnostics, rule, entry.files).length === 0) problems.push(noHit(entry, rule));

    for (const glob of skip.files) {
      const count = hitsOf(diagnostics, rule, new Set(skipFiles([glob], sources))).length;

      if (count > 0) report.push(`skip ${rule} in ${glob}: ${hits(count)} (${skip.reason})`);
    }
  }

  return { problems, report };
}

/** `skips: <rule> <n>, …`: per rule, the hits any entry turns off, each counted once; null when none. */
function countLine(entries: readonly Matched[], diagnostics: readonly Diagnostic[]): string | null {
  const counted = new Map<string, Set<Diagnostic>>();

  for (const entry of entries) {
    for (const rule of entry.skip.rules) {
      const found = counted.get(rule) ?? new Set();

      for (const hit of hitsOf(diagnostics, rule, entry.files)) found.add(hit);

      if (found.size > 0) counted.set(rule, found);
    }
  }

  const rules = [...counted.keys()].toSorted(byKey);

  return rules.length === 0 ? null : `skips: ${rules.map((rule) => `${rule} ${counted.get(rule)?.size}`).join(", ")}`;
}

/**
 * The JS/TS source files, the Rust ones (with a root Cargo.toml they are the repo's) and the stylesheets, the globs of
 * a skip match; or why git could not list them, each reason once, as the three listings fail alike.
 */
function sourcesOf(root: string): Result<string[]> {
  const lists = [sourceFiles(root), rustSources(root), cssFiles(root)];
  const errors = [...new Set(lists.flatMap((list) => (list.ok ? [] : list.error)))];
  const files = lists.flatMap((list) => (list.ok ? list.value : []));

  return errors.length > 0 ? { error: errors, ok: false } : { ok: true, value: files.toSorted(byKey) };
}

/**
 * The diagnostics of `files` under the generated config without skips, written to the root for the run only; the
 * package tags and the tailwind entry stay, so a skipped tag or class hit counts. A tag map or entry sync would refuse
 * returns sync's errors.
 */
function unskippedReport(workspace: Workspace, lint: ResolvedLint, { files, run }: Unskipped): Result<Diagnostic[]> {
  const tailwind = withTailwindEntry(workspace.root, lint);

  if (!tailwind.ok) return { error: tailwind.errors, ok: false };
  const built = oxlintConfig(workspace, { ...tailwind.lint, skip: [] });

  if (!built.ok) return { error: built.errors, ok: false };
  const rel = unskippedConfigPath(process.pid);
  const file = path.join(workspace.root, rel);
  fs.writeFileSync(file, built.value);

  try {
    return lintReport(workspace.root, ["-c", rel, ...files], run);
  } finally {
    fs.rmSync(file, { force: true });
  }
}

/**
 * Every `lint.skip` entry checked against the repo: a report line per rule and glob with its hits and reason, a count
 * per rule, and a problem for a glob that matches no source file and for a rule with no hit in its entry's files. The
 * hits are oxlint's without skips (`lint.boundaries` kept) and the script checks' ones `deps` hands over.
 */
export function checkLintSkips(workspace: Workspace, lint: ResolvedLint, deps: SkipDeps): SkipCheck {
  const { scripts, run = captureTool } = deps;
  const skips = lint.skip;

  if (skips.length === 0) return NONE;
  const listed = sourcesOf(workspace.root);

  if (!listed.ok) return { problems: listed.error, report: [] };
  const entries = skips.map((skip, index) => ({ files: new Set(skipFiles(skip.files, listed.value)), index, skip }));
  const files = [...new Set(entries.flatMap((entry) => [...entry.files]))].toSorted(byKey);
  const oxlinted = files.filter((file) => !RUST_SOURCE.test(file) && !isLintedCss(file));

  const linted =
    oxlinted.length === 0
      ? { ok: true as const, value: [] }
      : unskippedReport(workspace, lint, { files: oxlinted, run });

  if (!linted.ok) return { problems: linted.error, report: [] };
  const diagnostics = [...linted.value, ...scripts];

  const lines = entries.map((entry) => {
    const missing = entry.skip.files.filter((glob) => skipFiles([glob], listed.value).length === 0);
    // An entry that matches nothing is stale on its paths alone; its rules cannot hit.
    const checked = entry.files.size === 0 ? NONE : entryLines(entry, diagnostics, listed.value);

    return {
      problems: [...missing.map((glob) => noFile(entry.index, glob)), ...checked.problems],
      report: checked.report,
    };
  });

  const count = countLine(entries, diagnostics);

  return {
    problems: lines.flatMap((line) => line.problems),
    report: [...lines.flatMap((line) => line.report), ...(count === null ? [] : [count])],
  };
}

/**
 * `repo check`'s skip lines for the repo at `cwd`, given its script checks' hits with no skip applied: none without a
 * config, the standards pack or a readable workspace.
 */
export async function checkLintSkipsAt(cwd: string, scripts: readonly Diagnostic[]): Promise<SkipCheck> {
  const found = await standardsWorkspace(cwd);

  return found === null ? NONE : checkLintSkips(found.workspace, found.config.lint, { scripts });
}
