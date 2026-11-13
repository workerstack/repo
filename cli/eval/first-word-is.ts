const LEADING_MARKS = /^[*`/]+/;
const AFTER_WORD = /[^a-z0-9-].*$/is;

/**
 * A grader for the one-word answer `word`: the answer, trimmed and without leading `*`, backticks or slashes, must
 * start with it, case aside, and the word must not run on into more letters, digits or hyphens.
 */
export function firstWordIs(word: string): (answer: string) => boolean {
  return (answer) => {
    const run = answer.trim().replace(LEADING_MARKS, "").replace(AFTER_WORD, "");

    return run.toLowerCase() === word;
  };
}
