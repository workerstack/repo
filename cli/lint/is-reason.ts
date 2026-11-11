/** A reason is at least this many words of letters; fewer is a marker like `ok` or `safe`. */
const MIN_WORDS = 3;
const WORD = /\p{L}+(?:['’-]\p{L}+)*/gu;

/** Whether `text` holds a written reason: at least three words of letters. */
export function isReason(text: string): boolean {
  return (text.match(WORD) ?? []).length >= MIN_WORDS;
}
