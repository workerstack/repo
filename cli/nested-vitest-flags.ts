/**
 * Passed to every vitest that repo spawns inside a project. Vitest 5 keeps transformed modules in the workspace
 * root's `.vitest-cache` and, at start, wipes the whole directory when the project's lockfile hash differs from the
 * one recorded there (`ensureCacheIntegrity` in vitest's `cli-api` chunk). A project that links the packages of the
 * run that spawned it shares that directory, so the nested run would delete entries the outer run is still reading
 * and fail it with ENOENT at import.
 */
export const NESTED_VITEST_FLAGS: readonly string[] = ["--fsModuleCache=false"];
