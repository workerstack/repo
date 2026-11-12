/** The `repo --help` lines of the registry commands whose text is too long for one source line. */
export const CLEAN_SUMMARY: string =
  "Remove scratch and stale generated files " +
  "(--build: ignored build dirs; --deps: and node_modules; --dry-run lists only)";

export const COMMIT_MSG_SUMMARY: string =
  "Check a commit message file against the staged change (the commit-msg git hook), " +
  "each commit of --range <base>..<head>, or the commits a push sends (--pre-push)";

export const MUTATE_SUMMARY: string =
  "mutation-test the tracked files in a clone of HEAD (--shard i/n, --report <file>); " +
  "check <dir> [--write]: score reports against mutation-floors.json";

export const RELEASE_SUMMARY: string =
  "Release the root package: bump from commits, stamp CHANGELOG.md, commit, push, wait on CI, tag " +
  "([--stable | --pre <id>]); wait <name>@<version>: poll npm";

/** What asks a command for its usage, as the first argument after the command. */
export const HELP_FLAGS: ReadonlySet<string> = /* @__PURE__ */ new Set(["--help", "-h"]);

/**
 * The `repo <cmd> --help` usage lines of the registry commands whose own module holds none, each read from the
 * command's argv parsing.
 */
export const CLEAN_USAGE: string = "usage: repo clean [--build] [--deps] [--dry-run]";
export const DOCTOR_USAGE: string = "usage: repo doctor";
export const PURGE_MCPS_USAGE: string = "usage: repo purge-mcps [--apply]";
export const TASKS_USAGE: string = "usage: repo tasks";
export const YOLO_USAGE: string = "usage: repo yolo [--check | --dry-run] [--host <id>]";

export const JOB_USAGE: string =
  "usage: repo job --job search|exec|slice|fetch|test [--query <q>] [--path <p>] [--glob <g>] [--cwd <dir>] " +
  "[--stash <file>] [--from <n>] [--to <n>]";

export const PERSIST_USAGE: string =
  "usage: repo persist plan|roadmap|handoff|implementation|tmp [--workspace <dir>] < body";

export const CI_USAGE: string =
  "usage: repo ci [--no-coverage] [--report <file>] [--shard <i>/<n>] | skips <dir> | times <dir> | merge <dir> " +
  "| wait [<branch>]";

export const COMMIT_MSG_USAGE: string = "usage: repo commit-msg <file> | --range <base>..<head> | --pre-push <remote>";
export const COVERAGE_USAGE: string = "usage: repo coverage";
export const FMT_USAGE: string = "usage: repo fmt [--check] [<oxfmt args>…]";
export const LINT_USAGE: string = "usage: repo lint [<oxlint args>…] | --baseline";

export const MUTATE_USAGE: string =
  "usage: repo mutate [--shard <i>/<n>] [--report <file>] [--rust] | check <dir> [--write]";

export const TURN_USAGE: string = "usage: repo turn [--staged | <path>]";
