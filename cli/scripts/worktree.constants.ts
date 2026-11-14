/** The dir under the root that holds every managed worktree. */
export const WORKTREES_DIR = ".worktrees";

/** The branch prefix of a managed worktree: `.worktrees/<name>` is on `wt/<name>`. */
export const BRANCH_PREFIX = "wt/";

/** The ref prefix of a local branch. */
export const HEADS_REF = "refs/heads/";

/** How people and agents run this script, in every message that names a next step. */
export const WORKTREE_CMD = "bun repo worktree";

/** Exit code of a usage error. */
export const USAGE_EXIT = 2;

/** File descriptor of stderr, where git's and bun's own output goes so stdout carries only the result. */
export const STDERR_FD = 2;

/** Rebase and fast-forward rounds `finish` tries while the default branch keeps moving. */
export const MAX_FINISH_TRIES = 3;

/** The lockfiles whose presence makes a new worktree install its dependencies. */
export const LOCKFILES: readonly string[] = ["bun.lock", "bun.lockb"];

/** How long the dependency install of a new worktree may run. */
export const INSTALL_TIMEOUT_MS = 120_000;

/** The dir under the root that holds the bins its packages installed. */
export const BIN_DIR = "node_modules/.bin";

/** How long a delete of origin's branch or a `bun repo sync` in the root may run. */
export const REMOTE_TIMEOUT_MS = 30_000;
export const SYNC_TIMEOUT_MS = 120_000;

/** What `defaultBranch` names when no branch is checked out and none is known. */
export const NO_BRANCH = "HEAD";

/** `git rev-list --count` when the branch has nothing the default branch lacks. */
export const NOTHING_AHEAD = "0";

/** The `repo worktree` subcommands. */
export const ADD_CMD = "add";
export const FINISH_CMD = "finish";
export const LIST_CMD = "list";
export const PRUNE_CMD = "prune";
export const HOOK_CMD = "hook";

/** Every `repo worktree` subcommand, in the order help and usage name them. */
export const WORKTREE_SUBCOMMANDS: readonly string[] = [ADD_CMD, FINISH_CMD, LIST_CMD, PRUNE_CMD, HOOK_CMD];

/** What `repo worktree` takes. */
const NAMED_ARGS = `${ADD_CMD} <name> | ${FINISH_CMD} [<name>]`;
export const WORKTREE_ARGS: string = `${NAMED_ARGS} | ${LIST_CMD} | ${PRUNE_CMD} | ${HOOK_CMD}`;

/** What `repo worktree` prints for a command it does not know. */
export const USAGE: string = `usage: bun repo worktree ${WORKTREE_ARGS}`;

/** The Claude Code events the hook answers. */
export const CREATE_EVENT = "WorktreeCreate";
export const REMOVE_EVENT = "WorktreeRemove";

/** The shell words the guards read. */
export const GIT_BIN = "git";
const DIR_FLAG = "-C";
export const CONFIG_FLAG = "-c";
export const WORKTREE_SUB = "worktree";
export const PUSH_SUB = "push";
export const REASON_FLAG = "--reason";
export const DETACH_FLAG = "--detach";
export const DETACH_SHORT = "-d";
export const MESSAGE_FLAG = "-m";

/** The git options of `DIR_OPTIONS` that also take `=value`. */
export const LONG_DIR_OPTIONS: ReadonlySet<string> = /* @__PURE__ */ new Set(["--git-dir", "--work-tree"]);

/** The git options that set where git runs, each with a value: `-C dir`, `--git-dir dir`, `--work-tree dir`. */
export const DIR_OPTIONS: ReadonlySet<string> = /* @__PURE__ */ new Set([DIR_FLAG, ...LONG_DIR_OPTIONS]);

/** The variables that set where git runs, as `NAME=value` before it. */
export const DIR_VARIABLES: ReadonlySet<string> = /* @__PURE__ */ new Set(["GIT_DIR", "GIT_WORK_TREE"]);

/** The `git worktree add` flags that take a value. */
export const ADD_VALUE_FLAGS: readonly string[] = ["-b", "-B", REASON_FLAG];

/** The grant word a force push needs. */
export const FORCE_GRANT = "force";
