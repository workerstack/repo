/** The dir under the root that holds every managed worktree. */
export const WORKTREES_DIR = ".worktrees";

/** The branch prefix of a managed worktree: `.worktrees/<name>` is on `wt/<name>`. */
export const BRANCH_PREFIX = "wt/";

/** The ref prefix of a local branch. */
export const HEADS_REF = "refs/heads/";

/** What `repo worktree` takes. */
export const WORKTREE_ARGS = "add <name> | finish [<name>] | list | prune | hook";

/** What `repo worktree` prints for a command it does not know. */
export const USAGE: string = `usage: bun repo worktree ${WORKTREE_ARGS}`;

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

/** The Claude Code events the hook answers. */
export const CREATE_EVENT = "WorktreeCreate";
export const REMOVE_EVENT = "WorktreeRemove";

/** The shell words the guards read. */
export const GIT_BIN = "git";
export const CD_WORD = "cd";
export const DIR_FLAG = "-C";
export const CONFIG_FLAG = "-c";
export const WORKTREE_SUB = "worktree";
export const PUSH_SUB = "push";
export const REASON_FLAG = "--reason";
export const DETACH_FLAG = "--detach";
export const DETACH_SHORT = "-d";
export const MESSAGE_FLAG = "-m";

/** The `git worktree add` flags that take a value. */
export const ADD_VALUE_FLAGS: readonly string[] = ["-b", "-B", REASON_FLAG];

/** The grant word a force push needs. */
export const FORCE_GRANT = "force";

/** A here-string, which opens no heredoc, and the heredoc operator. */
export const HERE_STRING = "<<<";
export const HEREDOC = "<<";
