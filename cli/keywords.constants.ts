/** GitHub's topic limits: at most 20 topics, each lowercase letters, digits and dashes, 1 to 50 characters. */
export const KEYWORDS_MAX: number = 20;
const KEYWORD_MAX_LENGTH = 50;
export const KEYWORD_SHAPE: RegExp = /^[a-z0-9][a-z0-9-]{0,49}$/;

/** The file the keywords live in, as every line names it. */
export const KEYWORDS_FILE: string = "package.json";
export const KEYWORDS_FIELD: string = "keywords";
export const KEYWORDS_FIX: string = `list 1 to ${KEYWORDS_MAX} GitHub topics`;
export const KEYWORD_ENTRY_FIX: string = "write it as a GitHub topic";
export const KEYWORD_SHAPE_FIX: string = `use lowercase letters, digits and dashes, starting with a letter or digit, at most ${KEYWORD_MAX_LENGTH} characters`;
export const ONE: number = 1;
