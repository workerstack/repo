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
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseHookInput, type HookInput } from "./hook-input.ts";
import { canonicalPath, resolveRoots, type Roots } from "./workspace-root.ts";

export const WORKTREES_DIR = ".worktrees";
const BRANCH_PREFIX = "wt/";
const USAGE = "usage: bun repo worktree add <name> | finish [<name>] | list | prune | hook";
/** How people and agents run this script, in every message that names a next step. */
export const WORKTREE_CMD = "bun repo worktree";
const MAX_FINISH_TRIES = 3;
const LOCKFILES = ["bun.lock", "bun.lockb"];
const INSTALL_TIMEOUT_MS = 120_000;

/** A linked worktree as `git worktree list --porcelain` names it. */
interface WorktreeEntry {
  path: string;
  branch: string | null;
}

/** One `git worktree list` row with its state. */
export interface WorktreeInfo {
  path: string;
  branch: string | null;
  state: "clean" | "dirty" | "missing";
  merged: boolean;
  managed: boolean;
}

/** What `finishWorktree` landed; `sha` is null when the branch had no commits of its own. */
export interface FinishResult {
  branch: string;
  path: string;
  defaultBranch: string;
  sha: string | null;
}

/** The hook outcome Claude Code reads: exit code, stdout and stderr. */
export interface HookResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** The roots a guard reads: `root` always, `checkout` and `cwd` when the caller has them. */
export type WorktreeRoots = Pick<Roots, "root"> & Partial<Pick<Roots, "checkout" | "cwd">>;

/** One shell word and whether it is free of `$`, backticks and a leading `~`. */
interface Word {
  text: string;
  literal: boolean;
}

/** A git command found in a shell line: the dir it runs in, its subcommand and the words after it. */
interface GitCommand {
  at: string;
  sub: string;
  rest: Word[];
}

/** A parsed `git worktree add`. */
interface WorktreeAdd {
  at: string;
  target: Word | null;
  branch: string | null;
  commitish: string | null;
  detach: boolean;
}

/** What a shared-git rule knows about where a command runs. */
interface GitContext {
  p: typeof path;
  root: string;
  at: string;
  own: string | null;
  inMain: boolean;
  defaultBranch: () => string;
}

type SharedRule = (g: GitCommand, c: GitContext) => string | null;

interface Heredoc {
  word: string;
  indented: boolean;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** The caller named no worktree and is not inside one: a usage error, exit 2. */
class UsageError extends Error {}

function git(cwd: string, args: string[]): { ok: boolean; out: string; err: string } {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  return { ok: r.status === 0, out: (r.stdout || "").trim(), err: (r.stderr || "").trim() };
}

function samePath(a: string, b: string): boolean {
  return canonicalPath(path.resolve(a)) === canonicalPath(path.resolve(b));
}

/** A git-safe directory and branch name, or null when nothing usable is left. */
export function worktreeName(raw: unknown): string | null {
  const name = String(raw ?? "")
    .replace(/[^A-Za-z0-9._-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[.-]+/, "")
    .replace(/-+$/, "");
  return name || null;
}

/** True when `file` is a direct child of `<root>/.worktrees`, however git spells the path. */
export function isManaged(file: string, root: string, p: typeof path = path): boolean {
  const rel = p.relative(p.resolve(root, WORKTREES_DIR), p.resolve(file));
  return !!rel && !rel.startsWith("..") && !p.isAbsolute(rel) && !rel.includes(p.sep);
}

/** `git worktree list --porcelain`, main checkout first. */
function worktreeEntries(root: string): WorktreeEntry[] {
  const r = git(root, ["worktree", "list", "--porcelain"]);
  if (!r.ok) return [];
  return r.out
    .split(/\n\n+/)
    .map((block): WorktreeEntry | null => {
      const lines = block.split("\n");
      const field = (k: string) => lines.find((l) => l === k || l.startsWith(`${k} `));
      const wt = field("worktree");
      const branch = field("branch");
      return wt ? { path: canonicalPath(path.resolve(wt.slice("worktree ".length))), branch: branch ? branch.slice("branch refs/heads/".length) : null } : null;
    })
    .filter((e): e is WorktreeEntry => e !== null);
}

function branchExists(root: string, branch: string): boolean {
  return git(root, ["show-ref", "--verify", "-q", `refs/heads/${branch}`]).ok;
}

/**
 * The shared default branch, never just whatever the main checkout has out: `origin/HEAD`'s branch, else `init.defaultBranch`,
 * else `main`, else `master` (each only when it exists locally), else the main checkout's current branch, else "HEAD".
 */
export function defaultBranch(root: string): string {
  const remote = git(root, ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"]);
  const configured = git(root, ["config", "--get", "init.defaultBranch"]);
  const named = [remote.ok ? remote.out.replace(/^origin\//, "") : "", configured.ok ? configured.out : "", "main", "master"];
  const found = named.find((b) => b && branchExists(root, b));
  if (found) return found;
  const head = git(root, ["symbolic-ref", "--short", "HEAD"]);
  return head.ok ? head.out : "HEAD";
}

export function isMerged(root: string, branch: string): boolean {
  return git(root, ["merge-base", "--is-ancestor", `refs/heads/${branch}`, defaultBranch(root)]).ok;
}

/** The branch moved after it was created; no reflog counts as no, so a fresh worktree is never pruned. */
export function hasOwnCommits(root: string, branch: string): boolean {
  const r = git(root, ["reflog", "show", "--format=%gs", `refs/heads/${branch}`]);
  return r.ok && r.out.split("\n").some((l) => l && !l.startsWith("branch: Created from"));
}

/** Copy each gitignored file `.worktreeinclude` matches that the worktree lacks; never overwrite. */
function copyIncluded(root: string, dest: string): void {
  if (!fs.existsSync(path.join(root, ".worktreeinclude"))) return;
  const listed = git(root, ["ls-files", "--others", "--ignored", "--exclude-from=.worktreeinclude"]);
  const candidates = listed.out.split("\n").filter((rel) => rel && !rel.startsWith(`${WORKTREES_DIR}/`));
  if (!candidates.length) return;
  const ignored = spawnSync("git", ["check-ignore", "--stdin"], { cwd: root, input: candidates.join("\n"), encoding: "utf8" });
  for (const rel of (ignored.stdout || "").split("\n").filter(Boolean)) {
    const to = path.join(dest, rel);
    if (fs.existsSync(to)) continue;
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(path.join(root, rel), to);
  }
}

function requireName(raw: unknown): string {
  const name = worktreeName(raw);
  if (!name) throw new Error(`worktree name "${raw ?? ""}" has no usable characters; use letters, digits, ".", "_" or "-"`);
  return name;
}

/** Make or reuse `<root>/.worktrees/<name>` on `wt/<name>`; throws a one-line message when it cannot. */
export function addWorktree(root: string, raw: unknown): { path: string; branch: string; created: boolean } {
  const name = requireName(raw);
  const dest = path.join(root, WORKTREES_DIR, name);
  const branch = BRANCH_PREFIX + name;
  let known: WorktreeEntry | undefined = worktreeEntries(root).slice(1).find((e) => samePath(e.path, dest));
  if (known && !fs.existsSync(dest)) {
    git(root, ["worktree", "prune"]);
    known = undefined;
  }
  if (!known) {
    if (fs.existsSync(dest)) throw new Error(`${dest} exists and is not a worktree of this repo; move it or pick another name`);
    const args = branchExists(root, branch) ? ["worktree", "add", dest, branch] : ["worktree", "add", "-b", branch, dest, "HEAD"];
    // git's own output goes to stderr, so stdout carries only the path.
    if (spawnSync("git", args, { cwd: root, stdio: ["ignore", 2, 2] }).status !== 0) throw new Error(`git worktree add failed for ${dest}`);
  }
  copyIncluded(root, dest);
  if (!known) installDependencies(root, dest);
  return { path: canonicalPath(dest), branch, created: !known };
}

/**
 * A new worktree has no `node_modules`, so tools that look up `<cwd>/node_modules/.bin` fail there.
 * Install from the root's lockfile; the install's output goes to stderr and a failure only warns.
 */
function installDependencies(root: string, dest: string): void {
  if (!LOCKFILES.some((f) => fs.existsSync(path.join(root, f)))) return;
  const r = spawnSync("bun", ["install", "--frozen-lockfile"], { cwd: dest, stdio: ["ignore", 2, 2], timeout: INSTALL_TIMEOUT_MS });
  if (r.status !== 0) process.stderr.write(`could not install dependencies in ${dest}: run bun install --frozen-lockfile there\n`);
}

export function listWorktrees(root: string): WorktreeInfo[] {
  return worktreeEntries(root)
    .slice(1)
    .map((e): WorktreeInfo => {
      const state = !fs.existsSync(e.path) ? "missing" : git(e.path, ["status", "--porcelain"]).out ? "dirty" : "clean";
      const merged = !!e.branch && hasOwnCommits(root, e.branch) && isMerged(root, e.branch);
      return { path: e.path, branch: e.branch, state, merged, managed: isManaged(e.path, root) };
    });
}

/** git's first message plus its indented detail lines, on one line. */
function gitReason(err: string): string {
  const [first = "", ...more] = err.split("\n");
  const detail: string[] = [];
  for (const line of more) {
    if (!/^\s/.test(line)) break;
    detail.push(line.trim());
  }
  return [first, ...detail].join(" ") || "git gave no reason";
}

function rebaseInProgress(dir: string): boolean {
  const gitDir = git(dir, ["rev-parse", "--path-format=absolute", "--git-dir"]);
  return gitDir.ok && ["rebase-merge", "rebase-apply"].some((d) => fs.existsSync(path.join(gitDir.out, d)));
}

function tipOf(root: string, branch: string): string {
  return git(root, ["rev-parse", "--verify", "-q", `refs/heads/${branch}`]).out;
}

/** Move `target` to `branch`'s tip with a fast-forward only, in the root when it has `target` checked out, else through the ref. */
function fastForward(root: string, branch: string, target: string): ReturnType<typeof git> {
  const source = `refs/heads/${branch}`;
  const checkedOut = git(root, ["symbolic-ref", "--short", "HEAD"]).out === target;
  return checkedOut ? git(root, ["merge", "--ff-only", source]) : git(root, ["fetch", ".", `${source}:refs/heads/${target}`]);
}

/** Rebase the worktree onto `target`; on failure abort it and throw the conflict line or git's reason. */
function rebaseOnto(dest: string, branch: string, target: string): void {
  const rebased = git(dest, ["rebase", target]);
  if (rebased.ok) return;
  const files = git(dest, ["diff", "--name-only", "--diff-filter=U"]).out.split("\n").filter(Boolean);
  git(dest, ["rebase", "--abort"]);
  if (!files.length) throw new Error(`rebasing ${branch} onto ${target} failed: ${gitReason(rebased.err)}`);
  throw new Error(
    `rebasing ${branch} onto ${target} conflicts in ${files.join(", ")}: run git -C ${dest} rebase ${target}, fix each file, git -C ${dest} add <file>, git -C ${dest} rebase --continue, rerun the checks, then run finish again`,
  );
}

/**
 * Remove the worktree (never forced), then delete the branch once the default branch holds it.
 * A worktree dir that is already gone (another session's prune got there first) is only unregistered.
 */
function retire(root: string, worktree: string | undefined, branch: string): void {
  if (worktree) {
    const removed = fs.existsSync(worktree) ? git(root, ["worktree", "remove", worktree]) : null;
    if (!removed?.ok) {
      if (fs.existsSync(worktree)) throw new Error(`could not remove ${worktree}: ${gitReason(removed?.err ?? "")}; fix that, then run finish again`);
      git(root, ["worktree", "prune"]);
    }
  }
  if (isMerged(root, branch)) git(root, ["branch", "-D", branch]);
}

/**
 * Land `wt/<name>` on the default branch and remove it: rebase inside the worktree, fast-forward the default branch,
 * remove worktree and branch. A rerun converges from any crash point. Never pushes.
 * `rootArg` is the main checkout; an undefined `raw` takes the name from the worktree `cwd` is in.
 */
export function finishWorktree(rootArg: string, raw: string | undefined, cwd: string = rootArg): FinishResult {
  const root = canonicalPath(rootArg);
  const name = raw === undefined ? worktreeOf(canonicalPath(path.resolve(cwd)), root, path) : requireName(raw);
  if (!name) throw new UsageError("run finish inside .worktrees/<name> or pass its name");
  const branch = BRANCH_PREFIX + name;
  const dest = path.join(root, WORKTREES_DIR, name);
  let entry = worktreeEntries(root).slice(1).find((e) => samePath(e.path, dest));
  if (entry && !fs.existsSync(dest)) {
    git(root, ["worktree", "prune"]);
    entry = undefined;
  }
  if (!entry && !branchExists(root, branch)) {
    throw new Error(`no worktree or branch named ${name}: ${WORKTREE_CMD} list shows them`);
  }
  const target = defaultBranch(root);
  if (target === "HEAD") throw new Error(`${root} has no branch checked out and no origin/HEAD; check out the default branch there`);
  if (entry) {
    if (rebaseInProgress(dest)) {
      throw new Error(`${dest} is mid-rebase: finish it with git -C ${dest} rebase --continue (or --abort), then run finish again`);
    }
    if (entry.branch !== branch) {
      throw new Error(`${dest} has ${entry.branch ?? "a detached HEAD"} checked out, not ${branch}: run git -C ${dest} switch ${branch}, then run finish again`);
    }
    const dirty = git(dest, ["status", "--porcelain"]).out.split("\n").filter(Boolean).length;
    if (dirty) throw new Error(`${dest} has uncommitted changes in ${dirty} ${dirty === 1 ? "file" : "files"}: commit or drop them, then run finish again`);
  }
  const ahead = git(root, ["rev-list", "--count", `${target}..${branch}`]);
  if (!ahead.ok) throw new Error(`could not compare ${branch} with ${target}: ${gitReason(ahead.err)}`);
  if (ahead.out === "0") {
    const landed = hasOwnCommits(root, branch);
    const sha = landed ? git(root, ["rev-parse", "--short", `refs/heads/${branch}`]).out : null;
    retire(root, entry && dest, branch);
    return { branch, path: dest, defaultBranch: target, sha };
  }
  if (!entry) {
    throw new Error(`${branch} has commits that ${target} lacks and no worktree: run ${WORKTREE_CMD} add ${name} to bring it back, then run finish again`);
  }
  for (let attempt = 1; ; attempt++) {
    const before = tipOf(root, target);
    rebaseOnto(dest, branch, target);
    const forwarded = fastForward(root, branch, target);
    if (forwarded.ok) break;
    if (tipOf(root, target) === before) throw new Error(`could not fast-forward ${target} in ${root}: ${gitReason(forwarded.err)}`);
    if (attempt === MAX_FINISH_TRIES) throw new Error(`${target} kept moving while finishing ${branch}; run finish again`);
  }
  const sha = git(root, ["rev-parse", "--short", `refs/heads/${branch}`]).out;
  retire(root, dest, branch);
  return { branch, path: dest, defaultBranch: target, sha };
}

/** Remove clean managed worktrees whose own commits reached the default branch, then merged `wt/*` branches left without one. */
export function pruneWorktrees(root: string): { path: string | null; branch: string }[] {
  const removed: { path: string | null; branch: string }[] = [];
  for (const w of listWorktrees(root)) {
    if (!w.managed || w.state !== "clean" || !w.merged || !w.branch) continue;
    if (!git(root, ["worktree", "remove", w.path]).ok) continue;
    git(root, ["branch", "-D", w.branch]);
    removed.push({ path: w.path, branch: w.branch });
  }
  const held = new Set(worktreeEntries(root).map((e) => e.branch));
  const branches = git(root, ["for-each-ref", "--format=%(refname:short)", `refs/heads/${BRANCH_PREFIX}`]).out.split("\n");
  for (const b of branches.filter(Boolean)) {
    if (held.has(b) || !isMerged(root, b)) continue;
    if (git(root, ["branch", "-D", b]).ok) removed.push({ path: null, branch: b });
  }
  return removed;
}

/** Claude Code's WorktreeCreate / WorktreeRemove; other events do nothing. */
export function worktreeHook(data: HookInput | null): HookResult {
  const event = data && data.hook_event_name;
  try {
    if (event === "WorktreeCreate") {
      return { code: 0, stdout: `${addWorktree(resolveRoots(data).root, data?.name).path}\n`, stderr: "" };
    }
    if (event === "WorktreeRemove") {
      const target = String(data?.worktree_path || "");
      if (!target) return { code: 0, stdout: "", stderr: "" };
      const root = resolveRoots(data).root;
      const entry = worktreeEntries(root).slice(1).find((e) => samePath(e.path, target));
      if (entry) {
        const r = git(root, ["worktree", "remove", "--force", entry.path]);
        if (!r.ok && fs.existsSync(target)) return { code: 1, stdout: "", stderr: r.err || `could not remove ${target}` };
      }
      const branch = entry ? entry.branch : BRANCH_PREFIX + path.basename(target);
      if (branch && branch.startsWith(BRANCH_PREFIX) && branchExists(root, branch) && isMerged(root, branch)) {
        git(root, ["branch", "-D", branch]);
      }
    }
    return { code: 0, stdout: "", stderr: "" };
  } catch (e) {
    return { code: 1, stdout: "", stderr: errorMessage(e) };
  }
}

const HEREDOC_OP = /<<(-?)[ \t]*(?:'([^'\n]*)'|"([^"\n]*)"|\\?([^\s;&|<>()'"\\]+))/y;

/** The heredoc delimiters opened on one line, in order: `{ word, indented }`; a quoted `<<` or a `<<<` here-string opens none. */
function heredocsOpenedBy(line: string): Heredoc[] {
  const opened: Heredoc[] = [];
  let quote = "";
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!; // i < line.length
    if (quote) quote = ch === quote ? "" : quote;
    else if (ch === "\\") i++;
    else if (ch === "'" || ch === '"') quote = ch;
    else if (line.startsWith("<<<", i)) i += 2;
    else if (line.startsWith("<<", i)) {
      HEREDOC_OP.lastIndex = i;
      const m = HEREDOC_OP.exec(line);
      if (!m) {
        i++;
        continue;
      }
      opened.push({ word: m[2] ?? m[3] ?? m[4]!, indented: m[1] === "-" });
      i += m[0].length - 1;
    }
  }
  return opened;
}

/** `command` without heredoc bodies and their terminator lines: they are data, not commands. */
function dropHeredocBodies(command: unknown): string {
  const kept: string[] = [];
  let pending: Heredoc[] = [];
  for (const line of String(command).split("\n")) {
    if (pending.length) {
      const bare = line.replace(/\r$/, "");
      const { word, indented } = pending[0]!; // pending is non-empty here
      if ((indented ? bare.replace(/^\t+/, "") : bare) === word) pending.shift();
      continue;
    }
    kept.push(line);
    pending = heredocsOpenedBy(line);
  }
  return kept.join("\n");
}

/** Shell words per command segment; a word holding `$`, a backtick or a leading `~` is not literal. */
function shellSegments(command: unknown): Word[][] {
  const segments: Word[][] = [[]];
  // segments always holds at least the first, empty segment.
  const current = (): Word[] => segments[segments.length - 1]!;
  let word: Word | null = null;
  const end = () => {
    if (word) current().push(word);
    word = null;
  };
  const add = (text: string, literal = true) => {
    word = word || { text: "", literal: true };
    word.text += text;
    if (!literal) word.literal = false;
  };
  const s = dropHeredocBodies(command);
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!; // i < s.length
    if (ch === " " || ch === "\t") end();
    else if (";&|\n".includes(ch)) {
      end();
      if (current().length) segments.push([]);
    } else if (ch === "'") {
      const close = s.indexOf("'", i + 1);
      add(close === -1 ? s.slice(i + 1) : s.slice(i + 1, close));
      i = close === -1 ? s.length : close;
    } else if (ch === '"') {
      const close = s.indexOf('"', i + 1);
      const inner = close === -1 ? s.slice(i + 1) : s.slice(i + 1, close);
      add(inner, !/[$`\\]/.test(inner));
      i = close === -1 ? s.length : close;
    } else if (ch === "\\") {
      add(s[i + 1] ?? "");
      i++;
    } else add(ch, !(ch === "$" || ch === "`" || (ch === "~" && !word)));
  }
  end();
  return segments.filter((seg) => seg.length);
}

const ADD_VALUE_FLAGS = new Set(["-b", "-B", "--reason"]);

/** `{ at, sub, rest }` for a `[VAR=v] [rtk] [env VAR=v] git [-C dir] [-c k=v] <sub> …` segment; null for any other, or when a `-C` dir is not literal. */
function gitCommandOf(words: Word[], cwd: string, p: typeof path): GitCommand | null {
  let i = 0;
  // `FOO=1`, `env FOO=1` and the `rtk` proxy all stand before the real command.
  for (; i < words.length; i++) {
    // i < words.length in this loop and the next, so words[i] exists.
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(words[i]!.text)) continue;
    if (!/^(?:.*\/)?(?:rtk|env)$/.test(words[i]!.text)) break;
  }
  const bin = words[i]?.text || "";
  if (bin !== "git" && !bin.endsWith("/git")) return null;
  let at = cwd;
  for (i++; i < words.length && words[i]!.text.startsWith("-"); i++) {
    if (words[i]!.text === "-C") {
      const dir = words[++i];
      if (!dir || !dir.literal) return null;
      at = p.resolve(at, dir.text);
    } else if (words[i]!.text === "-c") i++;
  }
  const sub = words[i];
  return sub ? { at, sub: sub.text, rest: words.slice(i + 1) } : null;
}

/** Each git command of a shell line with the dir it runs in, following `cd <literal>` between segments. */
function* gitCommands(command: unknown, cwd: string, p: typeof path): Generator<GitCommand> {
  let here = cwd;
  for (const words of shellSegments(command)) {
    // shellSegments drops empty segments, so words[0] exists; words[1] is checked by the length test.
    if (words[0]!.text === "cd" && words.length === 2 && words[1]!.literal) {
      here = p.resolve(here, words[1]!.text);
      continue;
    }
    const g = gitCommandOf(words, here, p);
    if (g) yield g;
  }
}

/** `{ at, target, branch, commitish, detach }` for a `git … worktree add …` command, else null. */
function worktreeAddOf(g: GitCommand): WorktreeAdd | null {
  if (g.sub !== "worktree" || g.rest[0]?.text !== "add") return null;
  const out: WorktreeAdd = { at: g.at, target: null, branch: null, commitish: null, detach: false };
  for (let i = 1; i < g.rest.length; i++) {
    const w = g.rest[i]!; // i < g.rest.length
    if (ADD_VALUE_FLAGS.has(w.text)) {
      const value = g.rest[++i];
      if (w.text !== "--reason") out.branch = value ? value.text : null;
    } else if (w.text === "--detach" || w.text === "-d") out.detach = true;
    else if (w.text.startsWith("-")) continue;
    else if (!out.target) out.target = w;
    else if (!out.commitish) out.commitish = w.text;
  }
  return out;
}

/** `abs` relative to `dir` (`""` for `dir` itself), or null when `abs` is outside it. */
function relIn(abs: string, dir: string, p: typeof path): string | null {
  const rel = p.relative(dir, abs);
  return rel === ".." || rel.startsWith(`..${p.sep}`) || p.isAbsolute(rel) ? null : rel;
}

/** The `<name>` of the managed worktree under `root` that holds `abs`, else null. */
function worktreeOf(abs: string, root: string, p: typeof path): string | null {
  const rel = relIn(abs, p.join(root, WORKTREES_DIR), p);
  return rel ? (rel.split(p.sep)[0] ?? null) : null;
}

function hasCommit(root: string): boolean {
  return git(root, ["rev-parse", "--verify", "-q", "HEAD"]).ok;
}

/** The deny reason for a `git worktree add` aimed anywhere but `<root>/.worktrees/<name>` on `wt/<name>`, else null. */
export function worktreeAddReason(command: string, roots: WorktreeRoots, cwd: string, p: typeof path = path): string | null {
  for (const g of gitCommands(command, cwd, p)) {
    const add = worktreeAddOf(g);
    if (!add || !add.target || !add.target.literal) continue;
    const abs = canonicalPath(p.resolve(add.at, add.target.text), p);
    const name = isManaged(abs, roots.root, p) ? p.basename(abs) : null;
    const branch = add.branch ?? (add.detach ? null : add.commitish);
    if (name && branch === BRANCH_PREFIX + name) continue;
    const suggest = worktreeName(add.branch ? add.branch.replace(/^wt\//, "") : p.basename(abs)) || "<name>";
    return `worktrees live in ${p.join(roots.root, WORKTREES_DIR, "<name>")} on branch wt/<name>: run ${WORKTREE_CMD} add ${suggest}`;
  }
  return null;
}

/**
 * The deny reason for a write into the main checkout (inside the root, outside `.tmp` and `.worktrees`), else null.
 * Null as well when the root is not a git repo or has no commit yet, since no worktree can be made there.
 * `committed` is the git check, injectable for foreign-path tests.
 */
export function mainCheckoutWriteReason(
  target: string,
  roots: WorktreeRoots,
  p: typeof path = path,
  committed: (root: string) => boolean = hasCommit,
): string | null {
  const root = canonicalPath(roots.root, p);
  const abs = canonicalPath(p.resolve(roots.cwd || root, target), p);
  if (relIn(abs, root, p) === null) return null;
  if ([".tmp", WORKTREES_DIR].some((free) => relIn(abs, p.join(root, free), p) !== null)) return null;
  if (!committed(root)) return null;
  return `the main checkout is shared: run ${WORKTREE_CMD} add <name> and write under ${p.join(root, WORKTREES_DIR, "<name>")}; only ${p.join(root, ".tmp")}${p.sep} is writable here`;
}

/** The `.repo/lessons` dir of the root, or of the managed worktree, that holds `target`; null outside the root. */
export function managedLessonsDir(target: string, roots: WorktreeRoots, p: typeof path = path): string | null {
  const root = canonicalPath(roots.root, p);
  const abs = canonicalPath(p.resolve(roots.cwd || root, target), p);
  if (relIn(abs, root, p) === null) return null;
  const name = worktreeOf(abs, root, p);
  return p.join(name ? p.join(root, WORKTREES_DIR, name) : root, ".repo", "lessons");
}

const SHARED_GIT_OTHER = "belongs to another worktree: only its own session or the user may delete it";

/** One grant per word the user's message can name; a bare word only where it has no everyday meaning here. */
export const GIT_ASKED: Record<string, RegExp> = {
  stash: /\bstash\b/i,
  commit: /\bcommit\b/i,
  rebase: /\brebase\b/i,
  "cherry-pick": /\bcherry-pick\b/i,
  force: /\bforce[- ]push\b|\bpush\s+(?:-f|--force)\b/i,
  ...Object.fromEntries(
    ["checkout", "switch", "restore", "clean", "reset", "merge", "pull", "revert", "am", "branch", "worktree", "update-ref"].map((sub) => [
      sub,
      new RegExp(`\\bgit\\s+${sub}\\b`, "i"),
    ]),
  ),
};

/** The grant words in `prompt`, in `GIT_ASKED` order. */
export function gitAskedWords(prompt: unknown): string[] {
  const text = String(prompt ?? "");
  return Object.entries(GIT_ASKED)
    .filter(([, re]) => re.test(text))
    .map(([word]) => word);
}

function defaultBranchReason(branch: string, sub: string): string {
  return `${branch} is the shared default branch: move it only with ${WORKTREE_CMD} finish <name>, or when the user's message asks for git ${sub}`;
}

const inMainCheckout =
  (reason: SharedRule): SharedRule =>
  (g, c) =>
    c.inMain ? reason(g, c) : null;

function forcePushReason(g: GitCommand): string | null {
  const forced = g.rest.some((w) => /^-[A-Za-z]*f[A-Za-z]*$|^--force/.test(w.text) || /^\+./.test(w.text));
  return forced ? "a force push rewrites shared history: run it only when the user's message asks for a force push" : null;
}

function branchReason(g: GitCommand, c: GitContext): string | null {
  const flags = g.rest.filter((w) => w.text.startsWith("-")).map((w) => w.text);
  const moves = flags.some((f) => /^-[A-Za-z]*[dDmM][A-Za-z]*$|^--(?:delete|move)$/.test(f));
  const forces = flags.some((f) => /^-[A-Za-z]*f[A-Za-z]*$|^--force$/.test(f));
  if (!moves && !forces) return null;
  const names = g.rest.filter((w) => !w.text.startsWith("-") && w.literal).map((w) => w.text);
  const touched = moves ? names : names.slice(0, 1);
  const own = c.own === null ? null : BRANCH_PREFIX + c.own;
  const other = touched.find((n) => n.startsWith(BRANCH_PREFIX) && n !== own);
  if (other) return `${other} ${SHARED_GIT_OTHER}`;
  return touched.length && touched.includes(c.defaultBranch()) ? defaultBranchReason(c.defaultBranch(), "branch") : null;
}

/** The managed worktree a `git worktree remove` argument names: by path, or by the suffix git also accepts. */
function removedWorktree(raw: string, c: GitContext): string | null {
  const abs = canonicalPath(c.p.resolve(c.at, raw), c.p);
  if (isManaged(abs, c.root, c.p)) return c.p.basename(abs);
  return /^(?:\.worktrees[\\/])?([^\\/.][^\\/]*)$/.exec(raw)?.[1] ?? null;
}

function worktreeRemoveReason(g: GitCommand, c: GitContext): string | null {
  if (g.rest[0]?.text !== "remove") return null;
  const arg = g.rest.slice(1).find((w) => !w.text.startsWith("-"));
  const name = arg && arg.literal ? removedWorktree(arg.text, c) : null;
  return name && name !== c.own ? `${c.p.join(c.root, WORKTREES_DIR, name)} ${SHARED_GIT_OTHER}` : null;
}

function updateRefReason(g: GitCommand, c: GitContext): string | null {
  const refs: Word[] = [];
  for (let i = 0; i < g.rest.length; i++) {
    const w = g.rest[i]!; // i < g.rest.length
    if (w.text === "-m") i++;
    else if (!w.text.startsWith("-")) refs.push(w);
  }
  const ref = refs[0];
  if (!ref || !ref.literal || !ref.text.startsWith("refs/heads/")) return null;
  return ref.text === `refs/heads/${c.defaultBranch()}` ? defaultBranchReason(c.defaultBranch(), "update-ref") : null;
}

const SHARED_GIT = new Map<string, SharedRule>([
  ...["commit", "merge", "cherry-pick", "revert", "am", "pull"].map((sub): [string, SharedRule] => [
    sub,
    inMainCheckout((_g, c) => `the main checkout is shared: commit inside ${c.p.join(c.root, WORKTREES_DIR, "<name>")}, then run ${WORKTREE_CMD} finish <name>`),
  ]),
  ...["stash", "reset", "checkout", "switch", "restore", "clean", "rebase"].map((sub): [string, SharedRule] => [
    sub,
    inMainCheckout((g) => `git ${g.sub} in the main checkout can destroy other sessions' work: do it inside your worktree, or run it here only when the user's message asks for git ${g.sub}`),
  ]),
  ["push", forcePushReason],
  ["branch", branchReason],
  ["worktree", worktreeRemoveReason],
  ["update-ref", updateRefReason],
]);

/**
 * The deny reason for a git command that commits or destroys work in the main checkout, or that hits shared refs
 * from anywhere in the repo, else null. Inside your own managed worktree every other command runs.
 * `asked` holds the grant words (`GIT_ASKED`) the user's latest message named; a named subcommand passes.
 * Null as well when the root is not a git repo or has no commit yet. `committed` is the git check, injectable for foreign-path tests.
 */
export function sharedGitReason(
  command: string,
  roots: WorktreeRoots,
  cwd: string,
  asked: Set<string>,
  p: typeof path = path,
  committed: (root: string) => boolean = hasCommit,
): string | null {
  const root = canonicalPath(roots.root, p);
  let defaultName: string | undefined;
  for (const g of gitCommands(command, cwd, p)) {
    const rule = SHARED_GIT.get(g.sub);
    if (!rule || asked.has(g.sub === "push" ? "force" : g.sub)) continue;
    const at = canonicalPath(g.at, p);
    if (relIn(at, root, p) === null) continue;
    const own = worktreeOf(at, root, p);
    const c: GitContext = { p, root, at, own, inMain: own === null, defaultBranch: () => (defaultName ??= defaultBranch(root)) };
    const reason = rule(g, c);
    if (reason && committed(root)) return reason;
  }
  return null;
}

/** The one-line outcome of `finish`. */
function finishLine(result: FinishResult, root: string): string {
  if (!result.sha) return `${result.branch} has no commits of its own; removed ${result.path}`;
  return `merged ${result.branch} into ${result.defaultBranch} at ${result.sha} and removed ${result.path}; your shell may still be in it: cd ${root}`;
}

export function main(argv: string[]): number {
  const [cmd, arg] = argv;
  try {
    if (cmd === "add" && arg !== undefined) {
      process.stdout.write(`${addWorktree(resolveRoots({}).root, arg).path}\n`);
      return 0;
    }
    if (cmd === "finish") {
      const roots = resolveRoots({});
      process.stdout.write(`${finishLine(finishWorktree(roots.root, arg, roots.cwd), roots.root)}\n`);
      return 0;
    }
    if (cmd === "list") {
      for (const w of listWorktrees(resolveRoots({}).root)) {
        const cols = [w.path, w.branch || "(detached)", w.state, w.merged ? "merged" : "unmerged"];
        if (!w.managed) cols.push(`outside ${WORKTREES_DIR}`);
        process.stdout.write(`${cols.join("\t")}\n`);
      }
      return 0;
    }
    if (cmd === "prune") {
      const removed = pruneWorktrees(resolveRoots({}).root);
      for (const r of removed) process.stdout.write(r.path ? `removed ${r.path} (${r.branch})\n` : `deleted branch ${r.branch}\n`);
      if (!removed.length) process.stdout.write("nothing to prune\n");
      return 0;
    }
    if (cmd === "hook") {
      const raw = fs.readFileSync(0, "utf8") || "{}";
      const data = parseHookInput(raw);
      // A payload that is not JSON still fails the hook with the parse error; any other non-object is a no-op.
      if (!data) JSON.parse(raw);
      const res = worktreeHook(data);
      if (res.stdout) process.stdout.write(res.stdout);
      if (res.stderr) process.stderr.write(`${res.stderr}\n`);
      return res.code;
    }
  } catch (e) {
    process.stderr.write(`${errorMessage(e)}\n`);
    return e instanceof UsageError ? 2 : 1;
  }
  process.stderr.write(`${USAGE}\n`);
  return 2;
}

const invoked = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invoked === fileURLToPath(import.meta.url) || import.meta.url === pathToFileURL(invoked).href) {
  process.exitCode = main(process.argv.slice(2));
}
