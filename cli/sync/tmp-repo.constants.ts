/** One path segment: a `${...}` template hole or any run of characters that cannot end a path in text. */
function segment(): string {
  return String.raw`(?:\$\{[^}]*\}|[^\s/\\"'\`(),;:<>|*?\[\]{}])+`;
}

/** A path separator: `/`, `\`, or the doubled `\\` of a JSON string. */
function separator(): string {
  return String.raw`(?:\\\\|[\\/])`;
}

/** `.tmp/repo/<segment>` with either separator; not `.tmp/repository`. */
export function pathRe(): RegExp {
  return new RegExp(String.raw`\.tmp(${separator()})repo(?![A-Za-z0-9_-])(${separator()})(${segment()})`, "g");
}

/** `".tmp", "repo", "<segment>"` in any one quote style, joined by commas or spaces. */
export function arrayRe(): RegExp {
  return new RegExp(String.raw`(["'\`])\.tmp\1(\s*,\s*|\s+)\1repo\1(\s*,\s*|\s+)\1(${segment()})\1`, "g");
}
