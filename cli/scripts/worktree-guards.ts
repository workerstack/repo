import path from "node:path";

import { canonicalPath } from "./workspace-root.ts";
import { defaultBranch, hasCommit, isManaged, relIn, worktreeName, worktreeOf } from "./worktree-git.ts";
import { gitCommands, worktreeAddOf } from "./worktree-shell.ts";
import {
  BRANCH_PREFIX,
  FORCE_GRANT,
  HEADS_REF,
  MESSAGE_FLAG,
  PUSH_SUB,
  WORKTREE_CMD,
  WORKTREES_DIR,
} from "./worktree.constants.ts";
import type {
  GitCommand,
  GitContext,
  GuardEnv,
  SharedAt,
  SharedRule,
  ShellAt,
  Word,
  WorktreeAdd,
  WorktreeRoots,
} from "./worktree.types.ts";

/** The deny reason for one `git worktree add`, else null: only `<root>/.worktrees/<name>` on `wt/<name>` passes. */
function addReason(add: WorktreeAdd, root: string, p: typeof path): string | null {
  if (!add.target?.literal) return null;
  const abs = canonicalPath(p.resolve(add.at, add.target.text), p);
  const name = isManaged(abs, root, p) ? p.basename(abs) : null;
  const branch = add.branch ?? (add.detach ? null : add.commitish);
  if (name && branch === BRANCH_PREFIX + name) return null;
  const suggest = worktreeName(add.branch ? add.branch.replace(/^wt\//, "") : p.basename(abs)) || "<name>";
  return `worktrees live in ${p.join(root, WORKTREES_DIR, "<name>")} on branch wt/<name>: run ${WORKTREE_CMD} add ${suggest}`;
}

/** The deny reason for a `git worktree add` aimed anywhere but `<root>/.worktrees/<name>` on `wt/<name>`, else null. */
export function worktreeAddReason(command: string, at: ShellAt, p: typeof path = path): string | null {
  for (const g of gitCommands(command, at.cwd, p)) {
    const add = worktreeAddOf(g);
    const reason = add && addReason(add, at.roots.root, p);
    if (reason) return reason;
  }
  return null;
}

/**
 * The deny reason for a write into the main checkout (inside the root, outside `.tmp` and `.worktrees`), else null.
 * Null as well when the root is not a git repo or has no commit yet, since no worktree can be made there.
 * `guard.committed` is the git check, injectable for foreign-path tests.
 */
export function mainCheckoutWriteReason(target: string, roots: WorktreeRoots, guard: GuardEnv = {}): string | null {
  const { p = path, committed = hasCommit } = guard;
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

/** One grant per word the user's message can name; a bare word only where it has no everyday meaning here. */
const GIT_ASKED: Readonly<Record<string, RegExp>> = {
  am: /\bgit\s+am\b/i,
  branch: /\bgit\s+branch\b/i,
  checkout: /\bgit\s+checkout\b/i,
  "cherry-pick": /\bcherry-pick\b/i,
  clean: /\bgit\s+clean\b/i,
  commit: /\bcommit\b/i,
  force: /\bforce[- ]push\b|\bpush\s+(?:-f|--force)\b/i,
  merge: /\bgit\s+merge\b/i,
  pull: /\bgit\s+pull\b/i,
  rebase: /\brebase\b/i,
  reset: /\bgit\s+reset\b/i,
  restore: /\bgit\s+restore\b/i,
  revert: /\bgit\s+revert\b/i,
  stash: /\bstash\b/i,
  switch: /\bgit\s+switch\b/i,
  "update-ref": /\bgit\s+update-ref\b/i,
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

const commitReason: SharedRule = (_g, c) =>
  c.inMain
    ? `the main checkout is shared: commit inside ${c.p.join(c.root, WORKTREES_DIR, "<name>")}, then run ${WORKTREE_CMD} finish <name>`
    : null;

const destroyReason: SharedRule = (g, c) =>
  c.inMain
    ? `git ${g.sub} in the main checkout can destroy other sessions' work: do it inside your worktree, or run it here only when the user's message asks for git ${g.sub}`
    : null;

function forcePushReason(g: GitCommand): string | null {
  const forced = g.rest.some((w) => /^-[A-Za-z]*f[A-Za-z]*$|^--force/.test(w.text) || /^\+./.test(w.text));
  return forced
    ? "a force push rewrites shared history: run it only when the user's message asks for a force push"
    : null;
}

function branchReason(g: GitCommand, c: GitContext): string | null {
  const flags = g.rest.filter((w) => w.text.startsWith("-")).map((w) => w.text);
  const moves = flags.some((f) => /^-[A-Za-z]*[dDmM][A-Za-z]*$|^--(?:delete|move)$/.test(f));
  const forces = flags.some((f) => /^-[A-Za-z]*f[A-Za-z]*$|^--force$/.test(f));
  if (!moves && !forces) return null;
  const names = g.rest.filter((w) => !w.text.startsWith("-") && w.literal).map((w) => w.text);
  const touched = moves ? names : names.slice(0, 1);
  return touched.length && touched.includes(c.defaultBranch())
    ? defaultBranchReason(c.defaultBranch(), "branch")
    : null;
}

/** The ref words of a `git update-ref`: every word that is not a flag or the `-m` message. */
function refsOf(rest: Word[]): Word[] {
  const refs: Word[] = [];
  const words = rest[Symbol.iterator]();
  for (const w of words) {
    if (w.text === MESSAGE_FLAG) words.next();
    else if (!w.text.startsWith("-")) refs.push(w);
  }
  return refs;
}

function updateRefReason(g: GitCommand, c: GitContext): string | null {
  const [ref] = refsOf(g.rest);
  if (!ref?.literal || !ref.text.startsWith(HEADS_REF)) return null;
  return ref.text === HEADS_REF + c.defaultBranch() ? defaultBranchReason(c.defaultBranch(), "update-ref") : null;
}

const SHARED_GIT: Readonly<Record<string, SharedRule>> = {
  am: commitReason,
  branch: branchReason,
  checkout: destroyReason,
  "cherry-pick": commitReason,
  clean: destroyReason,
  commit: commitReason,
  merge: commitReason,
  pull: commitReason,
  push: forcePushReason,
  rebase: destroyReason,
  reset: destroyReason,
  restore: destroyReason,
  revert: commitReason,
  stash: destroyReason,
  switch: destroyReason,
  "update-ref": updateRefReason,
};

/** The reason one git command earns from its rule, else null; a granted subcommand or a dir outside the root passes. */
function ruleReason(g: GitCommand, at: SharedAt, c: Omit<GitContext, "inMain">): string | null {
  const rule = Object.hasOwn(SHARED_GIT, g.sub) ? SHARED_GIT[g.sub] : undefined;
  if (!rule || at.asked.has(g.sub === PUSH_SUB ? FORCE_GRANT : g.sub)) return null;
  const dir = canonicalPath(g.at, c.p);
  if (relIn(dir, c.root, c.p) === null) return null;
  return rule(g, { ...c, inMain: worktreeOf(dir, c.root, c.p) === null });
}

/**
 * The deny reason for a git command that commits or destroys work in the main checkout, or that hits shared refs
 * from anywhere in the repo, else null. Inside your own managed worktree every other command runs.
 * `at.asked` holds the grant words (`GIT_ASKED`) the user's latest message named; a named subcommand passes.
 * Null as well when the root is not a git repo or has no commit yet. `guard.committed` is the git check, injectable for foreign-path tests.
 */
export function sharedGitReason(command: string, at: SharedAt, guard: GuardEnv = {}): string | null {
  const { p = path, committed = hasCommit } = guard;
  const root = canonicalPath(at.roots.root, p);
  let defaultName: string | undefined;
  const c = { defaultBranch: (): string => (defaultName ??= defaultBranch(root)), p, root };
  for (const g of gitCommands(command, at.cwd, p)) {
    const reason = ruleReason(g, at, c);
    if (reason && committed(root)) return reason;
  }
  return null;
}
