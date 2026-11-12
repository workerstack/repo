/** The `repo --help` lines of the registry commands whose text is too long for one source line. */
export const CLEAN_SUMMARY: string =
  "Remove scratch and stale generated files " +
  "(--build: ignored build dirs; --deps: and node_modules; --dry-run lists only)";

export const COMMIT_MSG_SUMMARY: string =
  "Check a commit message file against the staged change (the commit-msg git hook), " +
  "or each commit of --range <base>..<head>";

export const MUTATE_SUMMARY: string =
  "mutation-test the tracked files in a clone of HEAD (--shard i/n, --report <file>); " +
  "check <dir> [--write]: score reports against mutation-floors.json";

export const RELEASE_SUMMARY: string =
  "Release the root package: bump from commits, stamp CHANGELOG.md, commit, push, wait on CI, tag " +
  "([--stable | --pre <id>]); wait <name>@<version>: poll npm";
