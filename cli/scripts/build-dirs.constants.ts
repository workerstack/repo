/** Dir names `repo clean --build` removes wherever git ignores them; the config's `clean.build` adds more. */
export const BUILD_DIRS: readonly string[] = [
  ".next",
  ".open-next",
  ".turbo",
  ".wrangler",
  ".tanstack",
  ".start",
  ".vite",
];

/** The dir `repo clean --deps` removes beside the build dirs. */
export const MODULES_DIR: string = "node_modules";

/** The suffix of a TypeScript incremental build file. */
export const TSBUILDINFO_SUFFIX: string = ".tsbuildinfo";

/** The most output one `git ls-files` listing may hold. */
export const LIST_BUFFER: number = 256 * 1024 * 1024;

/** What `repo clean` prints when both flags are given. */
export const BOTH_FLAGS: string = "repo clean: use one of --build or --deps (--deps includes --build)";

/** What `--deps` tells the user to do next. */
export const AFTER_DEPS: string = "; then run `bun install`";

/** The prefix of every `repo clean --build` refusal. */
export const CLEAN_PREFIX: string = "repo clean: ";
