/** The words bash reads specially while it looks for the `)` that ends a substitution. */
export type Keyword = "case" | "esac" | "in" | "lead" | "other";

/** The plain words that move a `case` on or start a command; `lead` marks a word after which a command starts. */
export const KEYWORDS: ReadonlyMap<string, Keyword> = /* @__PURE__ */ new Map([
  ["!", "lead"],
  ["case", "case"],
  ["do", "lead"],
  ["elif", "lead"],
  ["else", "lead"],
  ["esac", "esac"],
  ["if", "lead"],
  ["in", "in"],
  ["then", "lead"],
  ["time", "lead"],
  ["until", "lead"],
  ["while", "lead"],
  ["{", "lead"],
]);

/** The characters that end a word in a command. */
export const WORD_ENDS = " \t\n;&|()<>";

/** The characters inside a word that make it more than its plain text. */
export const UNPLAIN = "'\"`\\$(";

/** The characters before a `(` inside a word that make it an extended pattern such as `@(a|b)`. */
export const EXTGLOB_LEADS = "?*+@!";

/** The operators that end a `case` arm, longest first. */
export const ARM_ENDS = [";;&", ";;", ";&"] as const;
