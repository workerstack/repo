/** The old `mode: auto` line of a frontmatter, one per line, with any blanks around the value. */
export function modeAutoRe(): RegExp {
  return /^mode:[ \t]+auto[ \t]*$/gm;
}

/** The dirs under `.repo` whose `.md` files carry a `mode:` in their frontmatter. */
export const MODE_DIRS: readonly string[] = ["plans", "roadmaps"];
