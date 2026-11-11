/** Dependency-free JSONC helpers. The published CLI imports this, so keep it to node builtins. */

/** A JSON string (kept, group 1), a block comment or a line comment; used with replaceAll alone. */
const STRING_OR_COMMENT = /("(?:[^"\\]|\\.)*")|\/\*[\s\S]*?\*\/|\/\/[^\n]*/g;

/** Drop `//` and `/* *\/` comments outside JSON strings; comment markers inside strings stay. */
export function stripJsonc(text: unknown): string {
  return String(text ?? "").replaceAll(STRING_OR_COMMENT, (_match: string, str?: string) => str ?? "");
}
