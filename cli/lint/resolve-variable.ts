/** Ported from anti-slop (MIT, see anti-slop.LICENSE): `src/shared/scope.ts`. */
import type { TSESLint, TSESTree } from "@typescript-eslint/utils";

/** The binding `identifier` names, found by walking its lexical scopes outward; null when no scope declares it. */
export function resolveVariable(
  sourceCode: Readonly<TSESLint.SourceCode>,
  identifier: TSESTree.Identifier,
): TSESLint.Scope.Variable | null {
  let scope: TSESLint.Scope.Scope | null = sourceCode.getScope(identifier);

  while (scope !== null) {
    const variable = scope.set.get(identifier.name);

    if (variable !== undefined) return variable;
    scope = scope.upper;
  }

  return null;
}
