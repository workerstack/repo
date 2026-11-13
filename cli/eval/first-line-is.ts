const LEADING_SLASH = /^\//;
const WRAPPING_TICKS = /^`+|`+$/g;
const TRAILING_DOT = /\.$/;
const LATER_LINES = /\n.*$/s;

/**
 * A grader for the one-word answer `word`: the first line of the answer, trimmed, lowercased and without wrapping
 * backticks, a leading slash or a trailing dot, must equal it exactly.
 */
export function firstLineIs(word: string): (answer: string) => boolean {
  return (answer) => {
    const cleaned = answer
      .trim()
      .replace(LATER_LINES, "")
      .trim()
      .toLowerCase()
      .replaceAll(WRAPPING_TICKS, "")
      .replace(LEADING_SLASH, "")
      .replace(TRAILING_DOT, "");

    return cleaned === word;
  };
}
