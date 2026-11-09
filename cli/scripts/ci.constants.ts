/** A tsconfig file name in the root or a package directory. */
export const TSCONFIG_FILE: RegExp = /^tsconfig.*\.json$/;
/** A path segment under which a package is a fixture or an install, never typechecked. */
export const SKIPPED_SEGMENTS: readonly string[] = ["fixtures", `${"node"}_modules`];
export const TSC_ARGS: readonly string[] = ["--noEmit", "-p"];
export const VITEST_RUN_ARGS: readonly string[] = ["run", "--coverage"];
export const SUMMARY_SEPARATOR = " · ";
export const MS_PER_SECOND = 1000;
