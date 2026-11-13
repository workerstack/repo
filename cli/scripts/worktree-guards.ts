import path from "node:path";

import { IGNORED_DIRS, REPO, isIgnoredRepoPath } from "../repo-dirs.ts";
import { canonicalPath } from "./workspace-root.ts";
import { defaultBranch, hasCommit, isManaged, relIn, textOf, worktreeName, worktreeOf } from "./worktree-git.ts";
import {
  BRANCH_FORCE_FLAG,
  BRANCH_MOVE_FLAG,
  FORCE_OR_LONG_FORCE,
  GIT_ASKED,
  PLUS_REFSPEC,
  WT_BRANCH_PREFIX,
} from "./worktree-guards.constants.ts";
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

/** The `<name>` to suggest: the requested branch without `wt/`, else the target's basename. */
function suggestedName(branch: string | null, abs: string, p: typeof path): string {
  const wanted = branch === null || branch === "" ? p.basename(abs) : branch.replace(WT_BRANCH_PREFIX, "");

  return worktreeName(wanted) ?? "<name>";
}

/** The deny reason for one `git worktree add`, else null: only `<root>/.worktrees/<name>` on `wt/<name>` passes. */
function addReason(add: WorktreeAdd, root: string, p: typeof path): string | null {
  if (add.target?.literal !== true) return null;
  const abs = canonicalPath(p.resolve(add.at, add.target.text), p);
  const name = isManaged(abs, root, p) ? p.basename(abs) : null;
  const branch = add.branch ?? (add.detach ? null : add.commitish);

  if (name !== null && branch === BRANCH_PREFIX + name) return null;
  const suggest = suggestedName(add.branch, abs, p);

  return (
    `worktrees live in ${p.join(root, WORKTREES_DIR, "<name>")} on branch wt/<name>: ` +
    `run ${WORKTREE_CMD} add ${suggest}`
  );
}

/** The deny reason for a `git worktree add` aimed anywhere but `<root>/.worktrees/<name>` on `wt/<name>`, else null. */
export function worktreeAddReason(command: string, at: ShellAt, p: typeof path = path): string | null {
  for (const g of gitCommands(command, at.cwd, p)) {
    const add = worktreeAddOf(g);
    const reason = add === null ? null : addReason(add, at.roots.root, p);

    if (reason !== null) return reason;
  }

  return null;
}

/** `roots.cwd`, or `root` when the caller gave none. */
function cwdOr(roots: WorktreeRoots, root: string): string {
  return roots.cwd === undefined || roots.cwd === "" ? root : roots.cwd;
}

/**
 * The deny reason for a write into the main checkout (inside the root, outside `.repo/<ignored dir>` and `.worktrees`),
 * else null.
 * Null as well when the root is not a git repo or has no commit yet, since no worktree can be made there.
 * `guard.committed` is the git check, injectable for foreign-path tests.
 */
export function mainCheckoutWriteReason(target: string, roots: WorktreeRoots, guard: GuardEnv = {}): string | null {
  const { p = path, committed = hasCommit } = guard;
  const root = canonicalPath(roots.root, p);
  const abs = canonicalPath(p.resolve(cwdOr(roots, root), target), p);

  if (relIn(abs, root, p) === null) return null;

  if (isIgnoredRepoPath(root, abs, p) || relIn(abs, p.join(root, WORKTREES_DIR), p) !== null) return null;

  if (!committed(root)) return null;

  return (
    `the main checkout is shared: run ${WORKTREE_CMD} add <name> and write under ` +
    `${p.join(root, WORKTREES_DIR, "<name>")}; ` +
    `only ${p.join(root, REPO)}${p.sep}{${IGNORED_DIRS.join(",")}}${p.sep} is writable here`
  );
}

/** The `.repo/lessons` dir of the root, or of the managed worktree, that holds `target`; null outside the root. */
export function managedLessonsDir(target: string, roots: WorktreeRoots, p: typeof path = path): string | null {
  const root = canonicalPath(roots.root, p);
  const abs = canonicalPath(p.resolve(cwdOr(roots, root), target), p);

  if (relIn(abs, root, p) === null) return null;
  const name = worktreeOf(abs, root, p);

  return p.join(name === null ? root : p.join(root, WORKTREES_DIR, name), ".repo", "lessons");
}

/** The grant words in `prompt`, in `GIT_ASKED` order. */
export function gitAskedWords(prompt: string | undefined): string[] {
  const text = textOf(prompt);

  return Object.entries(GIT_ASKED)
    .filter(([, re]) => re.test(text))
    .map(([word]) => word);
}

function defaultBranchReason(branch: string, sub: string): string {
  return (
    `${branch} is the shared default branch: move it only with ${WORKTREE_CMD} finish <name>, ` +
    `or when the user's message asks for git ${sub}`
  );
}

function commitReason(_g: GitCommand, c: GitContext): string | null {
  return c.inMain
    ? `the main checkout is shared: commit inside ${c.p.join(c.root, WORKTREES_DIR, "<name>")}, ` +
        `then run ${WORKTREE_CMD} finish <name>`
    : null;
}

function destroyReason(g: GitCommand, c: GitContext): string | null {
  return c.inMain
    ? `git ${g.sub} in the main checkout can destroy other sessions' work: do it inside your worktree, ` +
        `or run it here only when the user's message asks for git ${g.sub}`
    : null;
}

function forcePushReason(g: GitCommand): string | null {
  const forced = g.rest.some((w) => FORCE_OR_LONG_FORCE.test(w.text) || PLUS_REFSPEC.test(w.text));

  return forced
    ? "a force push rewrites shared history: run it only when the user's message asks for a force push"
    : null;
}

function branchReason(g: GitCommand, c: GitContext): string | null {
  const flags = g.rest.filter((w) => w.text.startsWith("-")).map((w) => w.text);
  const moves = flags.some((f) => BRANCH_MOVE_FLAG.test(f));
  const forces = flags.some((f) => BRANCH_FORCE_FLAG.test(f));

  if (!moves && !forces) return null;
  const names = g.rest.filter((w) => !w.text.startsWith("-") && w.literal).map((w) => w.text);
  const touched = moves ? names : names.slice(0, 1);

  return touched.length > 0 && touched.includes(c.defaultBranch())
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

  if (ref?.literal !== true || !ref.text.startsWith(HEADS_REF)) return null;

  return ref.text === HEADS_REF + c.defaultBranch() ? defaultBranchReason(c.defaultBranch(), "update-ref") : null;
}

const SHARED_GIT = {
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
} as const satisfies Readonly<Record<string, SharedRule>>;

function isSharedSub(sub: string): sub is keyof typeof SHARED_GIT {
  return Object.hasOwn(SHARED_GIT, sub);
}

/** The reason one git command earns from its rule, else null; a granted subcommand or a dir outside the root passes. */
function ruleReason(g: GitCommand, at: SharedAt, c: Omit<GitContext, "inMain">): string | null {
  const rule = isSharedSub(g.sub) ? SHARED_GIT[g.sub] : undefined;

  if (rule === undefined || at.asked.has(g.sub === PUSH_SUB ? FORCE_GRANT : g.sub)) return null;
  const dir = canonicalPath(g.at, c.p);

  if (relIn(dir, c.root, c.p) === null) return null;

  return rule(g, { ...c, inMain: worktreeOf(dir, c.root, c.p) === null });
}

/**
 * The deny reason for a git command that commits or destroys work in the main checkout, or that hits shared refs
 * from anywhere in the repo, else null. Inside your own managed worktree every other command runs.
 * `at.asked` holds the grant words (`GIT_ASKED`) the user's latest message named; a named subcommand passes.
 * Null as well when the root is not a git repo or has no commit yet. `guard.committed` is the git check,
 * injectable for foreign-path tests.
 */
export function sharedGitReason(command: string, at: SharedAt, guard: GuardEnv = {}): string | null {
  const { p = path, committed = hasCommit } = guard;
  const root = canonicalPath(at.roots.root, p);
  let defaultName: string | undefined;
  const c = { defaultBranch: (): string => (defaultName ??= defaultBranch(root)), p, root };

  for (const g of gitCommands(command, at.cwd, p)) {
    const reason = ruleReason(g, at, c);

    if (reason !== null && committed(root)) return reason;
  }

  return null;
}
