/** The Rust source rules' names, limits and message text. */

/** Names a lint-level attribute in code. */
export const ATTRIBUTE_RULE = "repo/rust-lint-attribute" as const;
/** Names a Rust block comment. */
export const BLOCK_COMMENT_RULE = "repo/rust-block-comment" as const;
/** Names a file over the code-line limit. */
export const MAX_LINES_RULE = "repo/rust-max-lines" as const;
/** The most code lines a Rust file holds. */
export const MAX_CODE_LINES: number = 200;
/** The attribute names that set a lint level. */
export const LINT_LEVELS: readonly string[] = ["allow", "expect", "warn", "deny", "forbid"];
/** The attribute that applies others under a condition. */
export const CFG_ATTR: string = "cfg_attr";
/** Starts an attribute. */
export const ATTRIBUTE_START: string = "#";
/** Marks an inner attribute. */
export const INNER_MARK: string = "!";
/** Opens an attribute's brackets. */
export const OPEN_BRACKET: string = "[";
/** Closes an attribute's brackets. */
export const CLOSE_BRACKET: string = "]";
/** Opens a lint level's arguments. */
export const OPEN_PAREN: string = "(";
/** The message of a block comment. */
export const BLOCK_COMMENT_MESSAGE: string =
  "Rust comments use the line form (//, ///, //!); rewrite this /* */ as // lines";
/** The advice that follows the attribute a hit names. */
export const ATTRIBUTE_ADVICE: string =
  "sets a lint level in code; lint levels live on the command line, so fix the code or add a lint.skip entry with a reason";
/** The tokens an inner attribute puts before its bracket: the hash and the bang. */
export const INNER_SKIP: number = 2;
/** From a `cfg_attr`'s bracket to the token after its name, where the arguments open. */
export const AFTER_NAME: number = 2;
