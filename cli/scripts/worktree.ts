#!/usr/bin/env bun
/**
 * Worktrees live at `<root>/.worktrees/<name>` on branch `wt/<name>` (roadmap D5, D6).
 *
 *   bun repo worktree add <name>   make or reuse one; prints its path
 *   bun repo worktree finish [<name>]  rebase it onto the default branch, fast-forward that, remove worktree and branch
 *   bun repo worktree list         every linked worktree with its state
 *   bun repo worktree prune        remove clean ones whose own commits reached the default branch
 *   bun repo worktree hook         Claude Code WorktreeCreate / WorktreeRemove on stdin
 */
import fs from "node:fs";
import path from "node:path";

import { parseHookInput, type HookInput } from "./hook-input.ts";
import { processHookIo, readAllText, type HookIo } from "./hook-io.ts";
import { resolveRoots } from "./workspace-root.ts";
import { branchExists, errorMessage, git, isMerged, samePath, worktreeEntries } from "./worktree-git.ts";
import { addWorktree, finishWorktree, listWorktrees, pruneWorktrees } from "./worktree-lifecycle.ts";
import { WorktreeUsageError } from "./worktree-usage-error.ts";
import {
  ADD_CMD,
  BRANCH_PREFIX,
  CREATE_EVENT,
  FINISH_CMD,
  HOOK_CMD,
  LIST_CMD,
  PRUNE_CMD,
  REMOVE_EVENT,
  USAGE,
  USAGE_EXIT,
  WORKTREES_DIR,
} from "./worktree.constants.ts";
import type { FinishResult, HookResult, WorktreeInfo } from "./worktree.types.ts";

function quiet(): HookResult {
  return { code: 0, stderr: "", stdout: "" };
}

/** Delete `branch` when it is a merged `wt/*` branch. */
function dropMergedBranch(root: string, branch: string | null): void {
  if (branch && branch.startsWith(BRANCH_PREFIX) && branchExists(root, branch) && isMerged(root, branch)) {
    git(root, ["branch", "-D", branch]);
  }
}

/** WorktreeRemove: force-remove the worktree at `worktree_path`, then its branch once merged. */
function removeHooked(data: HookInput | null): HookResult {
  const target = String(data?.worktree_path || "");
  if (!target) return quiet();
  const root = resolveRoots(data).root;
  const entry = worktreeEntries(root)
    .slice(1)
    .find((e) => samePath(e.path, target));
  if (entry) {
    const r = git(root, ["worktree", "remove", "--force", entry.path]);
    if (!r.ok && fs.existsSync(target)) return { code: 1, stderr: r.err, stdout: "" };
  }
  dropMergedBranch(root, entry ? entry.branch : BRANCH_PREFIX + path.basename(target));
  return quiet();
}

/** Claude Code's WorktreeCreate / WorktreeRemove; other events do nothing. */
export function worktreeHook(data: HookInput | null): HookResult {
  const event = data && data.hook_event_name;
  try {
    if (event === CREATE_EVENT) {
      return { code: 0, stderr: "", stdout: `${addWorktree(resolveRoots(data).root, data?.name).path}\n` };
    }
    return event === REMOVE_EVENT ? removeHooked(data) : quiet();
  } catch (e) {
    return { code: 1, stderr: errorMessage(e), stdout: "" };
  }
}

/** The one-line outcome of `finish`. */
function finishLine(result: FinishResult, root: string): string {
  if (!result.sha) return `${result.branch} has no commits of its own; removed ${result.path}`;
  return `merged ${result.branch} into ${result.defaultBranch} at ${result.sha} and removed ${result.path}; your shell may still be in it: cd ${root}`;
}

function listRow(w: WorktreeInfo): string {
  const cols = [w.path, w.branch || "(detached)", w.state, w.merged ? "merged" : "unmerged"];
  if (!w.managed) cols.push(`outside ${WORKTREES_DIR}`);
  return cols.join("\t");
}

function pruneLines(root: string): string[] {
  const removed = pruneWorktrees(root);
  if (!removed.length) return ["nothing to prune"];
  return removed.map((r) => (r.path ? `removed ${r.path} (${r.branch})` : `deleted branch ${r.branch}`));
}

function print(lines: string[]): number {
  for (const line of lines) process.stdout.write(`${line}\n`);
  return 0;
}

function runHook(io: HookIo): number {
  const raw = readAllText(io) || "{}";
  const data = parseHookInput(raw);
  // A payload that is not JSON still fails the hook with the parse error; any other non-object is a no-op.
  if (!data) JSON.parse(raw);
  const res = worktreeHook(data);
  if (res.stdout) process.stdout.write(res.stdout);
  if (res.stderr) process.stderr.write(`${res.stderr}\n`);
  return res.code;
}

function finish(arg: string | undefined): number {
  const roots = resolveRoots({});
  return print([finishLine(finishWorktree(roots.root, arg, roots.cwd), roots.root)]);
}

/** Run one subcommand; null when `cmd` is none of them. */
function dispatch(cmd: string | undefined, arg: string | undefined, io: HookIo): number | null {
  if (cmd === ADD_CMD && arg !== undefined) return print([addWorktree(resolveRoots({}).root, arg).path]);
  if (cmd === FINISH_CMD) return finish(arg);
  if (cmd === LIST_CMD) return print(listWorktrees(resolveRoots({}).root).map(listRow));
  if (cmd === PRUNE_CMD) return print(pruneLines(resolveRoots({}).root));
  if (cmd === HOOK_CMD) return runHook(io);
  return null;
}

export function main(argv: string[], io: HookIo = processHookIo()): number {
  const [cmd, arg] = argv;
  try {
    const code = dispatch(cmd, arg, io);
    if (code !== null) return code;
  } catch (e) {
    process.stderr.write(`${errorMessage(e)}\n`);
    return e instanceof WorktreeUsageError ? USAGE_EXIT : 1;
  }
  process.stderr.write(`${USAGE}\n`);
  return USAGE_EXIT;
}
