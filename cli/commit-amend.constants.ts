/** How many processes up from the hook to look for git: a hook script, a runner, bunx and so on sit between. */
export const MAX_DEPTH = 8;

/** The init process: no process above it is a git that runs the hook. */
export const INIT_PID = 1;

/** How many argv tokens an option with a separate value takes: itself and its value. */
export const WITH_VALUE = 2;

/** Where the argv ends in a process's cmdline file, which closes every token with a NUL, the last one too. */
export const ARGV_END = -1;

/** The subcommand that amends. */
export const COMMIT = "commit";

/** The names git's executable goes by. */
export const GIT_NAMES: readonly string[] = ["git", "git.exe"];

/** What a path is cut on to find its last part, on any platform. */
export const PATH_SEPARATORS: RegExp = /[/\\]/;

/** Git's options before the subcommand that take the next token as their value. */
export const GLOBAL_VALUED: readonly string[] = [
  "-C",
  "-c",
  "--config-env",
  "--exec-path",
  "--git-dir",
  "--namespace",
  "--work-tree",
];

/** `git commit`'s options that take the next token as their value, so a message `--amend` is read as a message. */
export const COMMIT_VALUED: readonly string[] = [
  "-C",
  "-F",
  "-c",
  "-m",
  "-t",
  "--author",
  "--cleanup",
  "--date",
  "--file",
  "--fixup",
  "--message",
  "--pathspec-from-file",
  "--reedit-message",
  "--reuse-message",
  "--squash",
  "--template",
  "--trailer",
];

/** `--amend` and the prefixes git takes for it; `--no-` before one turns it off. */
export const AMEND: RegExp = /^--(no-)?am(e(nd?)?)?$/;
