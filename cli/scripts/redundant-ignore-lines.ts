/**
 * Redundant nested `.gitignore` writes (roadmap D4): a nested write is redundant when every literal line it adds
 * is already ignored by the parent `.gitignore` files alone. The gate denies those; everything unclear passes.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { childEnv } from "../env.ts";
import {
  CHECK_IGNORE_ROW_RE,
  COMMENT_MARK,
  GIT_ENV_DROP,
  GITIGNORE,
  GLOB_CHAR_RE,
  LEADING_SLASH_RE,
  NEGATION_MARK,
  PROBE_DIR,
  TRAILING_SLASH_RE,
} from "./gitignore-guard.constants.ts";
import type { IgnoreEdit, IgnoreHit, RedundantLine } from "./gitignore-guard.types.ts";
import { canonicalPath } from "./workspace-root.ts";

/** One added line and the paths that test it: the line's own dir, and one level deeper when unanchored. */
type LineProbes = { line: string; probes: [string, ...string[]] };

/** The scratch repo a check runs in: the git binary, its dir, and the top whose parent files it copies. */
type Scratch = { git: string; tmp: string; top: string };

function runGit(git: string, args: string[], cwd: string) {
  const env = childEnv();

  for (const k of GIT_ENV_DROP) delete env[k];

  return spawnSync(git, args, { cwd, encoding: "utf8", env });
}

/** Paths, relative to `top` with `/`, of the `.gitignore` in each directory above the target, from `top` down. */
export function parentIgnoreFiles(file: string, top: string, p: typeof path = path): string[] {
  const rel = p.relative(p.resolve(top), p.dirname(file));

  if (rel === "" || rel.startsWith("..") || p.isAbsolute(rel)) return [];
  const parts = rel.split(p.sep);

  return parts.map((_, i) => [...parts.slice(0, i), GITIGNORE].join("/"));
}

function nearestDir(file: string): string {
  let dir = path.dirname(file);

  while (!fs.existsSync(dir) && path.dirname(dir) !== dir) dir = path.dirname(dir);

  return dir;
}

function topOf(file: string, git: string): string | null {
  const r = runGit(git, ["rev-parse", "--show-toplevel"], nearestDir(file));

  return r.status === 0 ? canonicalPath(path.resolve(r.stdout.trim())) : null;
}

function probesOf(line: string, dir: string): LineProbes {
  const isAnchored = line.replace(TRAILING_SLASH_RE, "").includes("/");
  const body = line.replace(LEADING_SLASH_RE, "");

  const probes: [string, ...string[]] = isAnchored
    ? [`${dir}/${body}`]
    : [`${dir}/${body}`, `${dir}/${PROBE_DIR}/${body}`];

  return { line, probes };
}

/** A git repo at `s.tmp` holding a copy of each parent `.gitignore`; false when git cannot make one. */
function seedScratch(s: Scratch, parents: string[]): boolean {
  if (runGit(s.git, ["init", "-q", "--template="], s.tmp).status !== 0) return false;

  for (const rel of parents) {
    const src = path.join(s.top, ...rel.split("/"));

    if (!fs.existsSync(src)) continue;
    const dest = path.join(s.tmp, ...rel.split("/"));
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
  }

  return true;
}

/** The rule that ignores each probe that some rule ignores; null when git fails. */
function ignoreHits(s: Scratch, probes: string[]): Map<string, IgnoreHit> | null {
  const r = runGit(
    s.git,
    ["-c", "core.excludesFile=", "check-ignore", "--no-index", "-v", "--non-matching", "--", ...probes],
    s.tmp,
  );

  if (r.status !== 0 && r.status !== 1) return null;
  const hits = new Map<string, IgnoreHit>();

  for (const row of r.stdout.split("\n")) {
    const m = CHECK_IGNORE_ROW_RE.exec(row);

    if (m === null) continue;

    const [, source, n, pattern, probe] = [...m] /* every group matches, maybe empty */ as [
      string,
      string,
      string,
      string,
      string,
    ];

    if (source !== "" && !pattern.startsWith(NEGATION_MARK)) hits.set(probe, { n, pattern, source });
  }

  return hits;
}

/** Each line with its covering rule, when git ignores every probe; else []. */
function coveredLines(s: Scratch, items: LineProbes[]): RedundantLine[] {
  const hits = ignoreHits(
    s,
    items.flatMap((it) => it.probes),
  );

  if (hits === null || !items.every((it) => it.probes.every((q) => hits.has(q)))) return [];

  return items.map(({ line, probes }) => {
    const h = hits.get(probes[0]) /* every probe is in hits, checked above */ as IgnoreHit;

    return { line, rule: `${path.join(s.top, ...h.source.split("/"))}:${h.n} ${h.pattern}` };
  });
}

/**
 * The added lines of a nested `.gitignore` that its parent `.gitignore` files alone already ignore, each with the
 * covering rule; [] unless every added line is literal and covered.
 */
export function redundantIgnoreLines(
  target: string,
  added: string[],
  { git = "git" }: { git?: string } = {},
): RedundantLine[] {
  const lines = added.map((l) => l.trimEnd()).filter((l) => l !== "" && !l.startsWith(COMMENT_MARK));

  if (lines.length === 0 || lines.some((l) => l.startsWith(NEGATION_MARK) || GLOB_CHAR_RE.test(l))) return [];
  const file = canonicalPath(path.resolve(target));
  const top = topOf(file, git);
  const parents = top === null ? [] : parentIgnoreFiles(file, top);

  if (top === null || parents.length === 0) return [];
  const dir = path.relative(top, path.dirname(file)).split(path.sep).join("/");
  const s: Scratch = { git, tmp: fs.mkdtempSync(path.join(os.tmpdir(), "repo-ignore-")), top };

  try {
    if (!seedScratch(s, parents)) return [];

    return coveredLines(
      s,
      lines.map((l) => probesOf(l, dir)),
    );
  } finally {
    fs.rmSync(s.tmp, { force: true, recursive: true });
  }
}

/** The deny reason for the first edit whose added lines are all redundant, else null. */
export function redundantIgnoreReason(edits: IgnoreEdit[]): string | null {
  for (const e of edits) {
    const hits = e.added.length > 0 ? redundantIgnoreLines(e.file, e.added) : [];

    if (hits.length === 0) continue;
    const items = hits.map((h) => `"${h.line}" (ignored by ${h.rule})`).join(", ");

    return `redundant .gitignore lines in ${e.file}: ${items}. Leave them out; the parent rules already ignore them`;
  }

  return null;
}
