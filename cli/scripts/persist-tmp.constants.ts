/** Patterns and limits the one-off tmp saver shares with its readers. */

export const META_LINE_RE: RegExp = /^\s*TMP_(NAME|EXT):\s*.+\s*$/;
export const NAME_RE: RegExp = /^\s*TMP_NAME:\s*(.+?)\s*$/m;
export const EXT_RE: RegExp = /^\s*TMP_EXT:\s*(.+?)\s*$/m;
export const EXT_RE_OK: RegExp = /^[a-z0-9]+$/;

/** The extension of a tmp file is at most this long. */
export const EXT_MAX = 16;
export const DEFAULT_EXT = "md";
