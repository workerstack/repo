/**
 * The old strategy line of a frontmatter, `strategy: review-fast|review-deep|default` (optionally quoted), one per
 * line.
 */
export function frontmatterRe(): RegExp {
  return /^(strategy:[ \t]*["']?)(?:review-(fast|deep)|(default))(?![\w-])/gm;
}

/** The old strategy inside parentheses of a handoff: `(strategy: review-deep)`, `(strategy review-fast written)`. */
export function handoffRe(): RegExp {
  return /(\([^()\n]*\bstrategy:?[ \t]+)review-(fast|deep)(?![\w-])/g;
}

/**
 * The old `default` in the forms the hook writes, right after the parenthesis: `(strategy: default)`,
 * `(strategy default)`, `(strategy default written)`. Prose such as `(we kept the strategy default)` stays.
 */
export function handoffFreeRe(): RegExp {
  return /(\(strategy:?[ \t]+)default(?=\)| written\))/g;
}

/** The leading frontmatter block: the first `---` line at the very start through the next `---` line. */
export const LEADING_FRONTMATTER: RegExp = /^---\r?\n(?:[^\n]*\n)*?---(?=\r?\n|$)/;
