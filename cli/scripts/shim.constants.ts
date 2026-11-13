/** `repo shim`'s flags, file names and report words. */

export const DRY_RUN_FLAG = "--dry-run";
export const CHECK_FLAG = "--check";
export const DIR_FLAG = "--dir";
export const DIR_PREFIX = "--dir=";

export const USAGE: string = "usage: repo shim [--check | --dry-run] [--dir <path>]";

export const WINDOWS = "win32";

/** The launcher, as a file every OS gets, and the two extra files Windows needs for cmd.exe and PowerShell. */
export const LAUNCHER_NAME = "repo";
export const LAUNCHER_MJS = "repo.mjs";
export const LAUNCHER_CMD = "repo.cmd";

/** `repo.cmd` hands every argument to the `.mjs` copy beside it. */
export const CMD_BODY = '@bun "%~dp0repo.mjs" %*\r\n';

/** A path's trailing separators, dropped before two PATH entries are compared. */
export const TRAILING_SEPARATORS: RegExp = /[\\/]+$/;

export const EXECUTABLE = 0o755;

export const APPLY = "apply";
export const DRY_RUN = "dry-run";
export const UNCHANGED = "ok";
