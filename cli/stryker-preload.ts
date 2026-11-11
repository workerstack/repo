/**
 * Preloaded (`bun --preload`) by `repo mutate` before Stryker. Bun's native `Error.prepareStackTrace` throws "First
 * argument must be an Error object" on an Error-derived non-Error, which babel's stack rewriter and vite's
 * follow-redirects reach while Stryker loads its vitest runner; with no hook, bun's default stack formatting runs.
 * `cli/stryker-preload.test.ts` pins the bun bug: when it fails, delete this file and the `--preload` argument.
 */
Error.prepareStackTrace = undefined /* the lib types omit undefined; assigning it clears the native hook */ as never;
