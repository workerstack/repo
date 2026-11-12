/** Ported from anti-slop (MIT, see anti-slop.LICENSE): `src/rules/no-module-mocking.ts`. */
import { AST_NODE_TYPES, ESLintUtils, type TSESLint, type TSESTree } from "@typescript-eslint/utils";

import { isStringLiteral } from "../syntax-node.ts";
import { FRAMEWORK_SOURCES, MODULE_MOCK_METHODS } from "./no-module-mocking.constants.ts";
import { resolveVariable } from "./resolve-variable.ts";
import type { RepoRule } from "./rule.types.ts";

const MESSAGE =
  "{{call}} replaces a module for the whole file; pass the fake through a parameter, an options field or a real " +
  "stream instead";

/** Whether `name` is a test framework object's name, `vi` or `jest`. */
function isFrameworkName(name: string): name is keyof typeof FRAMEWORK_SOURCES {
  return Object.hasOwn(FRAMEWORK_SOURCES, name);
}

/** Whether `definition` imports the framework object `vi` from vitest or `jest` from @jest/globals, renamed or not. */
function isFrameworkImport(definition: TSESLint.Scope.Definition): boolean {
  if (definition.node.type !== AST_NODE_TYPES.ImportSpecifier) return false;
  const { imported, parent } = definition.node;
  const name = imported.type === AST_NODE_TYPES.Identifier ? imported.name : imported.value;
  const source = ESLintUtils.nullThrows(parent.source, "an import specifier's declaration has a source");

  return isFrameworkName(name) && FRAMEWORK_SOURCES[name] === source.value;
}

/** Whether `object` is a test framework object: the global `vi` or `jest`, or one imported from its package. */
function isFrameworkObject(sourceCode: Readonly<TSESLint.SourceCode>, object: TSESTree.Expression): boolean {
  if (object.type !== AST_NODE_TYPES.Identifier) return false;
  const variable = resolveVariable(sourceCode, object);

  if (variable === null || variable.defs.length === 0) return isFrameworkName(object.name);

  return variable.defs.some(isFrameworkImport);
}

/** The method `callee` names, `vi.mock` or `vi["mock"]`; null when it names none statically. */
function methodOf(callee: TSESTree.MemberExpression): string | null {
  const { property } = callee;

  if (!callee.computed) return property.type === AST_NODE_TYPES.Identifier ? property.name : null;

  return property.type === AST_NODE_TYPES.Literal && isStringLiteral(property) ? property.value : null;
}

/** Whether `callee` is a module mock: `mock`, `doMock` or `unstable_mockModule` on a test framework object. */
function isModuleMock(sourceCode: Readonly<TSESLint.SourceCode>, callee: TSESTree.Expression): boolean {
  if (callee.type !== AST_NODE_TYPES.MemberExpression || !isFrameworkObject(sourceCode, callee.object)) return false;
  const method = methodOf(callee);

  return method !== null && MODULE_MOCK_METHODS.includes(method);
}

/** Fails a vi or jest module mock, which tests the mock in place of the code; a real seam takes the fake instead. */
export const noModuleMocking: RepoRule<"moduleMock"> = {
  create(context) {
    return {
      CallExpression(node) {
        if (isModuleMock(context.sourceCode, node.callee))
          context.report({ data: { call: context.sourceCode.getText(node.callee) }, messageId: "moduleMock", node });
      },
    };
  },
  defaultOptions: [],
  meta: {
    docs: { description: "Disallow vi and jest module mocks; tests pass fakes through real parameters instead." },
    messages: { moduleMock: MESSAGE },
    schema: [],
    type: "problem",
  },
};
