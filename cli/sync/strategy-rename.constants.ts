/** The old strategy line of a frontmatter, `strategy: review-fast|deep` (optionally quoted), one per line. */
export function frontmatterRe(): RegExp {
  return /^(strategy:[ \t]*["']?)review-(fast|deep)(?![\w-])/gm;
}

/** The old strategy inside parentheses of a handoff: `(strategy: review-deep)`, `(strategy review-fast written)`. */
export function handoffRe(): RegExp {
  return /(\([^()\n]*\bstrategy:?[ \t]+)review-(fast|deep)(?![\w-])/g;
}

/** The leading frontmatter block: the first `---` line at the very start through the next `---` line. */
export const LEADING_FRONTMATTER: RegExp = /^---\r?\n(?:[^\n]*\n)*?---(?=\r?\n|$)/;
