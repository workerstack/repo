/** The old `mode:` line of a frontmatter, one per line: its value, `auto` or a kept one, after any blanks. */
export function modeLineRe(): RegExp {
  return /^mode:[ \t]+(auto|ask|away)[ \t]*$/gm;
}

/** The retired value that now reads as `ask`. */
export const OLD_AUTO = "auto";

/** The dirs under `.repo` whose `.md` files carry an `approval:` in their frontmatter. */
export const APPROVAL_DIRS: readonly string[] = ["plans", "roadmaps"];
