/** A line importing tailwindcss itself: `source(…)`, a layer or `;` may follow; `url(…)` and a subpath never match. */
export const TAILWIND_IMPORT: RegExp = /^\s*@import\s+["']tailwindcss["']/m;
/** Counts as words, by index; a count past the list is written in digits. */
export const COUNT_WORDS: readonly string[] = [
  "no",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
];
