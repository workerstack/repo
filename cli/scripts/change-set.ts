/**
 * The files `repo turn` gates: the index (`--staged`), the working tree against HEAD with the untracked files git
 * does not ignore, or every file of one package. Each file carries the workspace package that owns it.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { DELETED_STATUS, LAST, STATUS_PAIR } from "./change-set.constants.ts";

/** Which files a turn covers; `rel` is root-relative POSIX, `""` for the root. */
export type Scope = { kind: "staged" } | { kind: "tree" } | { kind: "package"; rel: string };
/** One changed file; `owner` is the dir of the package owning it, `""` for the root. */
export type Change = { rel: string; deleted: boolean; owner: string };
export type ChangeSetResult = { ok: true; changes: Change[] } | { ok: false; errors: string[] };

/** git's empty tree: what a repo with no commit yet diffs against. */
const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

/** git in the root: its stdout, and whether it exited 0. */
type Git = (args: string[]) => { ok: boolean; out: string };
type Entry = { rel: string; deleted: boolean };
type Entries = { ok: true; entries: Entry[] } | { ok: false; errors: string[] };

function gitIn(root: string): Git {
  return (args) => {
    const run = spawnSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    return { ok: run.status === 0, out: run.stdout };
  };
}

/** The deepest package dir holding `rel`, or `""` for the root. */
export function ownerOf(rel: string, packages: readonly string[]): string {
  const holding = packages.filter((dir) => rel === dir || rel.startsWith(`${dir}/`));
  return holding.sort((a, b) => a.length - b.length).at(LAST) ?? "";
}

/** `--name-status -z` output as path and whether git saw it deleted. */
function statuses(out: string): Entry[] {
  const fields = out.split("\0").filter((part) => part !== "");
  // Each status field is followed by its path; a status with no path after it is dropped.
  return Array.from({ length: Math.floor(fields.length / STATUS_PAIR) }, (_, n) => {
    const at = n * STATUS_PAIR;
    const [status, rel] = fields.slice(at, at + STATUS_PAIR) /* n counts whole pairs only */ as [string, string];
    return { deleted: status === DELETED_STATUS, rel };
  });
}

const names = (out: string): string[] => out.split("\0").filter((rel) => rel !== "");

/** The base the working tree is compared to: HEAD, or the empty tree before the first commit. */
function base(git: Git): string {
  return git(["rev-parse", "--verify", "-q", "HEAD"]).ok ? "HEAD" : EMPTY_TREE;
}

const DIFF = ["--name-status", "-z", "--no-renames"];
const UNTRACKED = ["ls-files", "--others", "--exclude-standard", "-z"];

function staged(git: Git): Entries {
  const index = statuses(git(["diff", "--cached", ...DIFF]).out);
  const unstaged = new Set(names(git(["diff", "--name-only", "-z"]).out));
  const partial = index.filter((entry) => unstaged.has(entry.rel));
  if (partial.length === 0) return { entries: index, ok: true };
  return {
    errors: partial.map(
      ({ rel }) => `${rel} has staged and unstaged changes; stage the rest (git add ${rel}) or undo it`,
    ),
    ok: false,
  };
}

function tree(git: Git): Entries {
  const tracked = statuses(git(["diff", base(git), ...DIFF]).out);
  const untracked = names(git(UNTRACKED).out).map((rel) => ({ deleted: false, rel }));
  return { entries: [...tracked, ...untracked], ok: true };
}

/** Every file under `dir`, tracked or untracked; a tracked file missing from disk is a deletion. */
function whole(git: Git, root: string, dir: string): Entries {
  const listed = names(git(["ls-files", "--cached", "--others", "--exclude-standard", "-z", "--", dir || "."]).out);
  // An unmerged path is listed once per stage.
  const entries = [...new Set(listed)].map((rel) => ({ deleted: !fs.existsSync(path.join(root, rel)), rel }));
  return { entries, ok: true };
}

/** A submodule or a nested checkout is a directory entry: listed by git, gated by its own repo. */
function isDirectory(root: string, rel: string): boolean {
  return rel.endsWith("/") || fs.lstatSync(path.join(root, rel), { throwIfNoEntry: false })?.isDirectory() === true;
}

function listOf({ git, root }: { git: Git; root: string }, scope: Scope, owner: string | null): Entries {
  if (scope.kind === "staged") return staged(git);
  return owner === null ? tree(git) : whole(git, root, owner);
}

/** The change set of `scope` under the git repo at `root`, sorted, each file with its owning package. */
export function changeSet(root: string, scope: Scope, packages: readonly string[]): ChangeSetResult {
  const git = gitIn(root);
  if (!git(["rev-parse", "--git-dir"]).ok) return { errors: [`${root} is not in a git repo`], ok: false };
  const scopeOwner = scope.kind === "package" ? ownerOf(scope.rel, packages) : null;
  const listed = listOf({ git, root }, scope, scopeOwner);
  if (!listed.ok) return listed;
  const changes = listed.entries
    .filter((entry) => !isDirectory(root, entry.rel))
    .map((entry) => ({ ...entry, owner: ownerOf(entry.rel, packages) }))
    .filter((change) => scopeOwner === null || change.owner === scopeOwner)
    .sort((a, b) => Number(a.rel > b.rel) - Number(a.rel < b.rel));
  return { changes, ok: true };
}
