/** Dependency-free JSONC helpers. The published CLI imports this, so keep it to node builtins. */

/** Drop `//` and `/* *\/` comments outside JSON strings; comment markers inside strings stay. */
export function stripJsonc(text) {
  return String(text ?? "").replace(
    /("(?:[^"\\]|\\.)*")|\/\*[\s\S]*?\*\/|\/\/[^\n]*/g,
    (match, str) => str ?? "",
  );
}
