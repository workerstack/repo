const SCOPE_PATTERN: RegExp = /^(@[^/*]+\/)\*$/;

/**
 * True when `name` is what `pattern` names: `@scope/*` takes every name in that scope, anything else matches
 * exactly.
 */
export function matchesName(pattern: string, name: string): boolean {
  const scope = SCOPE_PATTERN.exec(pattern)?.[1];

  return scope === undefined ? pattern === name : name.startsWith(scope);
}
