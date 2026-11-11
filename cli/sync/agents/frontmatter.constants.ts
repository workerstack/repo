/** The line that opens and closes a frontmatter block. */
export const FENCE = "---";
/** A CR, alone or before an LF. */
export const CR_LINE_ENDS: RegExp = /\r\n?/g;
/** A byte-order mark at the start of a file. */
export const LEADING_BOM: RegExp = /^\uFEFF/;
/** The colon a YAML error's first line ends on. */
export const TRAILING_COLON: RegExp = /:$/;
/** What `findIndex` returns when nothing matches. */
export const NOT_FOUND = -1;

/** Newlines and control characters, which only a double-quoted scalar can escape. */
export const NEEDS_ESCAPES: RegExp = /[\u0000-\u001f\u007f\u2028\u2029\uFEFF]/;
/** A first character YAML reads as an indicator. */
export const INDICATOR_FIRST: RegExp = /^[,[\]{}#&*!|>'"%@`]/;
/** A `-`, `?` or `:` alone or before a space, which YAML reads as an entry or key. */
export const INDICATOR_SPACED: RegExp = /^[-?:](?:\s|$)/;
/** A `: ` anywhere, read as a mapping. */
export const COLON_SPACE: RegExp = /:(?:\s|$)/;
/** A ` #`, read as a comment. */
export const SPACE_HASH: RegExp = /\s#/;
/** What the YAML 1.1 dumper behind `.claude/agents` quoted anywhere, and at the start. */
export const CLAUDE_ANYWHERE: RegExp = /[,[\]{}:]/;
export const CLAUDE_FIRST: RegExp = /^[-?=]/;

const BOOL_WORDS = "[yYnN]|yes|Yes|YES|no|No|NO|on|On|ON|off|Off|OFF";
const SEXAGESIMAL = "[-+]?[0-9][0-9_]*(?::[0-5]?[0-9])+(?:\\.[0-9_]*)?";
const NUMBER =
  "[-+]?(?:0b[01_]+|0x[0-9a-fA-F_]+|0[0-7_]+|[0-9][0-9_]*(?:\\.[0-9_]*)?(?:[eE][-+]?[0-9]+)?|" +
  "\\.[0-9_]+(?:[eE][-+]?[0-9]+)?)";
const DATE = "[0-9]{4}-[0-9]{1,2}-[0-9]{1,2}(?:[Tt ].*)?";
/** Words and numbers a YAML 1.1 reader types though YAML 1.2 reads them as strings. */
export const YAML_11_TYPED: Readonly<RegExp> = /* @__PURE__ */ new RegExp(
  `^(?:${BOOL_WORDS}|${SEXAGESIMAL}|${NUMBER}|${DATE})$`,
);

/** The indent of one nesting level. */
export const INDENT = "  ";
