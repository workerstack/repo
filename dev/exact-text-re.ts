const REGEX_SYNTAX_RE = /[.*+?^${}()|[\]\\]/g;

/** A regex, with no flags, that matches the joined `parts` as plain text: each regex syntax character escaped. */
export function exactTextRe(...parts: string[]): RegExp {
  return new RegExp(parts.join("").replaceAll(REGEX_SYNTAX_RE, "\\$&"));
}
