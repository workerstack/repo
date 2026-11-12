/** The extensions of the files the sorter and the comment conversion read. */
export const JSONC_EXTENSIONS: readonly string[] = [".json", ".jsonc"];

/** The manifest oxfmt sorts itself (`sortPackageJson`), so the sorter leaves it alone. */
export const MANIFEST_NAME = "package.json";

/** The git pathspecs listing every json file with room for comments, at any depth. */
export const JSONC_PATHSPECS: readonly string[] = ["*.json", "*.jsonc"];

/** A pattern starting with this is anchored at the repo root. */
export const ANCHOR = "/";

/** The prefix that lets a pattern match at any depth, and the suffix that lets it match what lies under a folder. */
export const ANY_DEPTH = "**/";
export const UNDER = "/**";

/** A comment line of the generated oxfmt config. */
export const COMMENT_LINE: RegExp = /^\/\/.*$/gm;

/** The spaces `sortedJsonValue` indents with. */
export const INDENT = 2;

/** What follows the first key out of order in the message; `--check` is the only caller. */
export const FIX_HINT = "run `bun repo fmt`";

/** What follows a config problem in an error. */
export const SYNC_HINT = "run `bun repo sync` to write it";
export const SYNC_AGAIN_HINT = "run `bun repo sync` to write it again";
