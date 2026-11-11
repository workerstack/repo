/** Workspace leftovers (roadmap D9), each with the command that clears exactly it. Reads only; deletes nothing. */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { nestedHolds, nestedTmpDirs } from "./clean-scan.ts";
import { row } from "./doctor-rows.ts";
import {
  DAY_SECONDS,
  GIT_MAX_BUFFER,
  GITIGNORE,
  MIN_DIR_LINE,
  MS_PER_SECOND,
  NOT_FOUND,
  SORTS_BEFORE,
  STALE_DAYS,
} from "./doctor.constants.ts";
import type { WorkspaceIssue } from "./doctor.types.ts";
import { redundantIgnoreLines } from "./redundant-ignore-lines.ts";
import { canonicalPath, gitRevParse } from "./workspace-root.ts";
import { defaultBranch } from "./worktree-git.ts";
import { listWorktrees } from "./worktree-lifecycle.ts";
import { WORKTREE_CMD } from "./worktree.constants.ts";
import type { WorktreeInfo } from "./worktree.types.ts";

const LINE_RE = /\r?\n/;

function gitOut(cwd: string, args: string[]): string | null {
  const r = spawnSync("git", args, { cwd, encoding: "utf8", maxBuffer: GIT_MAX_BUFFER });
  return r.status === 0 ? r.stdout : null;
}

function ignoreLines(file: string): string[] {
  try {
    return fs
      .readFileSync(file, "utf8")
      .split(LINE_RE)
      .map((l) => l.trimEnd());
  } catch {
    return [];
  }
}

/** Whole days since the branch's last commit when it holds commits the default branch lacks, else null. */
function daysSinceUnmergedCommit(root: string, branch: string, target: string): number | null {
  const ahead = Number(gitOut(root, ["rev-list", "--count", `${target}..refs/heads/${branch}`]));
  const last = Number(gitOut(root, ["log", "-1", "--format=%ct", `refs/heads/${branch}`]));
  return ahead > 0 && last > 0 ? Math.floor((Date.now() / MS_PER_SECOND - last) / DAY_SECONDS) : null;
}

// Paths in one list are distinct, so two never compare equal.
function byPath(a: { path: string }, b: { path: string }): number {
  return a.path < b.path ? SORTS_BEFORE : 1;
}

function strayIssues(root: string): WorkspaceIssue[] {
  return nestedTmpDirs(root).map((dir) => {
    const holds = nestedHolds(dir);
    return {
      clear: `rm -r ${dir}`,
      detail: holds === null ? "" : `holds ${holds}`,
      kind: "stray .tmp/repo",
      path: dir,
    };
  });
}

function redundantIssues(top: string): WorkspaceIssue[] {
  const listed = gitOut(top, ["ls-files", "-co", "--exclude-standard", "-z", "--", ":(glob)**/.gitignore"]) ?? "";
  const redundant: WorkspaceIssue[] = [];
  for (const rel of new Set(listed.split("\0").filter((r) => r !== "" && r !== GITIGNORE))) {
    const file = path.join(top, ...rel.split("/"));
    const lines = ignoreLines(file).filter((l) => l !== "" && !l.startsWith("#"));
    const hits = lines.length > 0 ? redundantIgnoreLines(file, lines) : [];
    if (hits.length === 0) continue;
    const isTracked = gitOut(top, ["ls-files", "--error-unmatch", "--", rel]) !== null;
    const detail = hits.map((h) => `"${h.line}" ignored by ${h.rule}`).join(", ");
    redundant.push({
      clear: isTracked ? `git -C ${top} rm -q ${rel}` : `rm ${file}`,
      detail,
      kind: "redundant .gitignore",
      path: file,
    });
  }
  return redundant;
}

function duplicateIssues(top: string): WorkspaceIssue[] {
  const rootIgnore = path.join(top, GITIGNORE);
  const lines = ignoreLines(rootIgnore);
  const duplicate: WorkspaceIssue[] = [];
  for (const [i, line] of lines.entries()) {
    if (!line.endsWith("/") || line.startsWith("!") || line.length < MIN_DIR_LINE) continue;
    const bare = lines.indexOf(line.slice(0, line.length - 1));
    if (bare === NOT_FOUND) continue;
    duplicate.push({
      clear: `delete line ${i + 1} of ${rootIgnore}`,
      detail: `"${lines[bare]}" on line ${bare + 1} covers it`,
      kind: "duplicate .gitignore line",
      path: `${rootIgnore}:${i + 1} "${line}"`,
    });
  }
  return duplicate;
}

function label(w: WorktreeInfo): string {
  return w.branch ?? "detached";
}

function staleIssues(root: string, worktrees: WorktreeInfo[]): WorkspaceIssue[] {
  const target = defaultBranch(root);
  const stale: WorkspaceIssue[] = [];
  for (const w of worktrees) {
    if (!w.managed || w.state === "missing" || w.merged || w.branch === null) continue;
    const days = daysSinceUnmergedCommit(root, w.branch, target);
    if (days === null || days < STALE_DAYS) continue;
    const clear = `${WORKTREE_CMD} finish ${path.basename(w.path)}`;
    stale.push({ clear, detail: `${w.branch}, last commit ${days} days ago`, kind: "stale worktree", path: w.path });
  }
  return stale;
}

function issue(kind: string, clear: (w: WorktreeInfo) => string): (w: WorktreeInfo) => WorkspaceIssue {
  return (w: WorktreeInfo) => ({
    clear: clear(w),
    detail: label(w),
    kind,
    path: w.path,
  });
}

function worktreeIssues(root: string): WorkspaceIssue[] {
  const worktrees = listWorktrees(root);
  const missing = worktrees.filter((w) => w.state === "missing");
  const outside = worktrees.filter((w) => w.state !== "missing" && !w.managed);
  const merged = worktrees.filter((w) => w.state === "clean" && w.managed && w.merged);
  return [
    ...missing.map(issue("missing worktree", () => `git -C ${root} worktree prune`)).toSorted(byPath),
    ...outside
      .map(issue("worktree outside .worktrees", (w) => `git -C ${root} worktree remove ${w.path}`))
      .toSorted(byPath),
    ...merged.map(issue("merged worktree", () => `${WORKTREE_CMD} prune`)).toSorted(byPath),
    ...staleIssues(root, worktrees).toSorted(byPath),
  ];
}

/**
 * Workspace leftovers (roadmap D9), each with the command that clears exactly it. Reads only; deletes nothing.
 */
export function workspaceIssues({ root, checkout }: { root: string; checkout: string }): WorkspaceIssue[] {
  // resolveRoots already asked git about this dir; the memo saves a spawn.
  const facts = gitRevParse(checkout);
  if (facts === null) return [];
  const top = canonicalPath(path.resolve(facts.top));
  return [
    ...strayIssues(root).toSorted(byPath),
    ...redundantIssues(top).toSorted(byPath),
    ...duplicateIssues(top),
    ...worktreeIssues(root),
  ];
}

export function workspaceLines(items: WorkspaceIssue[]): string[] {
  if (items.length === 0) return [row("workspace", "ok")];
  return [
    row("workspace", `${items.length} to clear`, "report only; nothing was deleted"),
    ...items.map((i) => `- ${i.kind} ${i.path}${i.detail === "" ? "" : ` (${i.detail})`}: ${i.clear}`),
  ];
}
