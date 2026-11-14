#!/usr/bin/env bun
/**
 * Worktrees live at `<root>/.worktrees/<name>` on branch `wt/<name>` (roadmap D5, D6).
 *
 *   bun repo worktree add <name>   make or reuse one; prints its path
 *   bun repo worktree finish [<name>]  rebase it onto the default branch, fast-forward that, remove worktree and
 *                                  branch, delete origin's copy and run `bun repo sync` in the root; under the
 *                                  pull-request workflow push it and open its pull request, and clean up once merged
 *   bun repo worktree list         every linked worktree with its state
 *   bun repo worktree prune        remove clean ones whose own commits reached the default branch, and origin's copies
 *   bun repo worktree hook         Claude Code WorktreeCreate / WorktreeRemove on stdin
 */
import fs from "node:fs";
import path from "node:path";

import { z } from "zod";

import { readJson } from "../json.ts";
import { errorMessage } from "../sync-errors.ts";
import { parseHookInput, type HookInput } from "./hook-input.ts";
import { processHookIo, readAllText, type HookIo } from "./hook-io.ts";
import { resolveRoots } from "./workspace-root.ts";
import { branchExists, git, isMerged, samePath, worktreeEntries } from "./worktree-git.ts";
import { addWorktree, finishWith, listWorktrees, pruneWorktrees } from "./worktree-lifecycle.ts";
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
  WORKTREE_CMD,
  WORKTREES_DIR,
} from "./worktree.constants.ts";
import type { FinishDeps, FinishResult, HookResult, PullRequestFinish, WorktreeInfo } from "./worktree.types.ts";

function quiet(): HookResult {
  return { code: 0, stderr: "", stdout: "" };
}

/** Delete `branch` when it is a merged `wt/*` branch. */
function dropMergedBranch(root: string, branch: string | null): void {
  if (branch !== null && branch.startsWith(BRANCH_PREFIX) && branchExists(root, branch) && isMerged(root, branch))
    git(root, ["branch", "-D", branch]);
}

/** WorktreeRemove: force-remove the worktree at `worktree_path`, then its branch once merged. */
function removeHooked(data: HookInput | null): HookResult {
  const target = data?.worktree_path ?? "";

  if (target === "") return quiet();
  const root = resolveRoots(data).root;

  const entry = worktreeEntries(root)
    .slice(1)
    .find((e) => samePath(e.path, target));

  if (entry !== undefined) {
    const r = git(root, ["worktree", "remove", "--force", entry.path]);

    if (!r.ok && fs.existsSync(target)) return { code: 1, stderr: r.err, stdout: "" };
  }

  dropMergedBranch(root, entry === undefined ? BRANCH_PREFIX + path.basename(target) : entry.branch);

  return quiet();
}

/** Claude Code's WorktreeCreate / WorktreeRemove; other events do nothing. */
export function worktreeHook(data: HookInput | null): HookResult {
  const event = data?.hook_event_name;

  try {
    if (event === CREATE_EVENT)
      return { code: 0, stderr: "", stdout: `${addWorktree(resolveRoots(data).root, data?.name).path}\n` };

    return event === REMOVE_EVENT ? removeHooked(data) : quiet();
  } catch (e) {
    return { code: 1, stderr: errorMessage(e), stdout: "" };
  }
}

/** The one-line outcome of a pull-request `finish`. */
function pullRequestLine(result: PullRequestFinish, root: string): string {
  const again = `run ${WORKTREE_CMD} ${FINISH_CMD} ${result.branch.slice(BRANCH_PREFIX.length)} again once it merges`;

  if (result.kind === "opened") return `pushed ${result.branch} and opened ${result.url}; ${again}`;

  if (result.kind === "updated") return `pushed ${result.branch} to ${result.url}; ${again}`;

  return (
    `${result.branch} merged through ${result.url}; ${result.defaultBranch} is at ${result.sha} ` +
    `and removed ${result.path}; your shell may still be in it: cd ${root}`
  );
}

/** The one-line outcome of `finish`. */
function finishLine(result: FinishResult, root: string): string {
  if ("kind" in result) return pullRequestLine(result, root);

  if (result.sha === null || result.sha === "")
    return `${result.branch} has no commits of its own; removed ${result.path}`;

  return (
    `merged ${result.branch} into ${result.defaultBranch} at ${result.sha} and removed ${result.path}; ` +
    `your shell may still be in it: cd ${root}`
  );
}

function listRow(w: WorktreeInfo): string {
  const cols = [w.path, w.branch ?? "(detached)", w.state, w.merged ? "merged" : "unmerged"];

  if (!w.managed) cols.push(`outside ${WORKTREES_DIR}`);

  return cols.join("\t");
}

function pruneLines(root: string): string[] {
  const removed = pruneWorktrees(root);

  if (removed.length === 0) return ["nothing to prune"];

  return removed.map((r) => (r.path === null ? `deleted branch ${r.branch}` : `removed ${r.path} (${r.branch})`));
}

function print(lines: string[]): number {
  for (const line of lines) process.stdout.write(`${line}\n`);

  return 0;
}

function runHook(io: HookIo): number {
  const text = readAllText(io);
  const raw = text === "" ? "{}" : text;
  const data = parseHookInput(raw);

  // A payload that is not JSON still fails the hook with the parse error; any other non-object is a no-op.
  if (data === null) readJson(z.json(), raw);
  const res = worktreeHook(data);

  if (res.stdout !== "") process.stdout.write(res.stdout);

  if (res.stderr !== "") process.stderr.write(`${res.stderr}\n`);

  return res.code;
}

function finish(arg: string | undefined, deps: FinishDeps): number {
  const roots = resolveRoots({});

  return print([finishLine(finishWith(deps)(roots.root, arg, roots.cwd), roots.root)]);
}

/** Run the subcommand `argv` opens with; null when it is none of them. */
function dispatch(argv: string[], io: HookIo, deps: FinishDeps): number | null {
  const [cmd, arg] = argv;

  if (cmd === ADD_CMD && arg !== undefined) return print([addWorktree(resolveRoots({}).root, arg).path]);

  if (cmd === FINISH_CMD) return finish(arg, deps);

  if (cmd === LIST_CMD) return print(listWorktrees(resolveRoots({}).root).map(listRow));

  if (cmd === PRUNE_CMD) return print(pruneLines(resolveRoots({}).root));

  if (cmd === HOOK_CMD) return runHook(io);

  return null;
}

/** Run `bun repo worktree <argv>`; `deps` swaps finish's gh and workflow read for tests. */
export function main(argv: string[], io: HookIo = processHookIo(), deps: FinishDeps = {}): number {
  try {
    const code = dispatch(argv, io, deps);

    if (code !== null) return code;
  } catch (e) {
    process.stderr.write(`${errorMessage(e)}\n`);

    return e instanceof WorktreeUsageError ? USAGE_EXIT : 1;
  }

  process.stderr.write(`${USAGE}\n`);

  return USAGE_EXIT;
}
