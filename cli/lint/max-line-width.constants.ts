/** The line width oxfmt formats to, and the width `repo/max-line-width` allows. */
export const PRINT_WIDTH = 120;

/** A URL cannot wrap, so a line that is long only by one is left alone. */
export const URL_TEXT: RegExp = /https?:\/\/\S+/g;

/** The call whose one string argument is an age cipher: base64 that cannot wrap, so its columns are not counted. */
export const SEALED_CALLEE = "sealed";
export const CALL_EXPRESSION = "CallExpression";
export const IDENTIFIER = "Identifier";
export const TRAILING_CR: RegExp = /\r$/;

/** The key every node holds its parent under; a walk of the children skips it. */
export const PARENT_KEY = "parent";

/** An emoji grapheme: oxfmt counts the whole cluster as 2 columns. Built from a string for the `v` flag. */
export const EMOJI: Readonly<RegExp> = /* @__PURE__ */ new RegExp("^\\p{RGI_Emoji}$", "v");

/** The columns oxfmt gives an emoji grapheme. */
export const EMOJI_WIDTH = 2;

/** The node types whose text oxfmt never splits: a string or regex literal, and a template's text. */
export const LITERAL = "Literal";
export const TEMPLATE_ELEMENT = "TemplateElement";

/** A code point that takes no column: a combining mark, the joiner, or a variation selector. */
export const ZERO_WIDTH: RegExp = /^(?:\p{Mark}|\u200D|[\uFE00-\uFE0F])$/u;
export const COMMENT_HINT = "wrap the comment onto more lines";
export const STRING_HINT = "split the string with + or a join";
export const REGEX_HINT = "build the regex from named parts";
export const CODE_HINT = "extract part into a named const";
