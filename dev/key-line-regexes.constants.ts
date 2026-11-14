/** The oxc node types the key-line regex check reads. */
export const NODE = {
  call: "CallExpression",
  identifier: "Identifier",
  literal: "Literal",
  new: "NewExpression",
  template: "TemplateLiteral",
} as const;

/** The constructor a regex built from a string goes through. */
export const REGEXP = "RegExp";

/** The flag that makes `^` and `$` match at each line, so the pattern reads past one line. */
export const MULTILINE = "m";

/** What ends a key before its value: `KEY:` or `KEY =`. */
export const KEY_ENDS: ReadonlySet<string> = /* @__PURE__ */ new Set([":", "="]);

/** What a template's `${…}` reads as in the cooked pattern; any non-syntax text works. */
export const HOLE = "k";

/** What starts an escape in a pattern. */
export const ESCAPE = "\\";

/** The escape letter after `\` that matches any space, the newline too. */
export const SPACE = "s";

/** What opens and closes a character class, inside which `:\s` is no key. */
export const CLASS_OPEN = "[";
export const CLASS_CLOSE = "]";

/** What comes before the `:` or `=` of a group head (`(?:`, `(?=`, `(?<=`), which is no key. */
export const GROUP_HEADS: readonly string[] = ["(?", "(?<"];
