/** The one folder name that holds fixtures: test data lives in `__fixtures__`. */
export const FIXTURES_DIR: string = "__fixtures__";

/** Folder names that mean fixtures and must be called `__fixtures__` instead. */
export const FIXTURE_LIKE_NAMES: readonly string[] = [
  "fixtures",
  "fixture",
  "__fixture__",
  "test-fixtures",
  "test_fixtures",
  "testdata",
];

/** Folders never scanned for fixture folders: third-party code, not ours to rename. */
export const UNSCANNED_DIRS: readonly string[] = ["vendor", "node_modules"];

/** Files the path rewrite never edits: the rule itself, its tests and the stock history keyed by old paths. */
export const REWRITE_EXCLUDED_PATHS: readonly string[] = [
  "cli/fixtures.constants.ts",
  "cli/check-fixtures.ts",
  "cli/check-fixtures.test.ts",
  "cli/fixtures-rename.ts",
  "cli/fixtures-rename.test.ts",
  "cli/sync/stock-history.json",
];

/** The `repo --help` line of `repo fixtures`. */
export const FIXTURES_SUMMARY: string =
  "Rename fixture folders to __fixtures__ and rewrite their path references (--fix: apply; else list)";

/** The flag that applies the rename; without it `repo fixtures` only lists. */
export const FIX_FLAG: string = "--fix";

/** How to call `repo fixtures`. */
export const FIXTURES_USAGE: string = `usage: repo fixtures [${FIX_FLAG}]`;

/** The exit code of a command line `repo fixtures` does not take. */
export const USAGE_EXIT: number = 2;

/** What `findIndex` returns when nothing matches. */
export const NOT_FOUND: number = -1;
