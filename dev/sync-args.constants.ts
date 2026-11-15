/** The build that emits `dist`, as bun arguments run in the root. */
export const BUILD_ARGS: readonly string[] = ["run", "build"];

/** The sync that follows linking, as bun arguments run in the root. */
export const SYNC_ARGS: readonly string[] = ["bin/repo.ts", "sync", "--postinstall"];

/** The `process.platform` value of Windows, where a directory link is a junction to an absolute path. */
export const WINDOWS = "win32";
