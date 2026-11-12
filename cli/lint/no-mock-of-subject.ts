import path from "node:path";

import { AST_NODE_TYPES, type TSESTree } from "@typescript-eslint/utils";

import { HREF, IMPORT_META, META_URL, URL_CLASS } from "./no-mock-of-subject.constants.ts";
import type { RepoRule } from "./rule.types.ts";

const TEST_FILE = /\.(?:test|spec)(\.[cm]?[jt]sx?)$/;
const EXTENSION = /\.[cm]?[jt]sx?$/;
/** `vi.mock`, `vi.doMock` and `jest.mock` replace a module for the whole test file. */
const MOCKS: Readonly<Record<string, readonly string[]>> = { jest: ["mock"], vi: ["mock", "doMock"] };

type Node = TSESTree.Node;

function stringOf(node: Node | undefined): string | null {
  return node?.type === AST_NODE_TYPES.Literal && typeof node.value === "string" ? node.value : null;
}

function isImportMetaUrl(node: Node | undefined): boolean {
  return (
    node?.type === AST_NODE_TYPES.MemberExpression &&
    node.object.type === AST_NODE_TYPES.MetaProperty &&
    node.object.meta.name === IMPORT_META &&
    node.property.type === AST_NODE_TYPES.Identifier &&
    node.property.name === META_URL
  );
}

/** The relative path of `new URL("<rel>", import.meta.url).href`, or null for any other node. */
function urlPath(node: Node): string | null {
  if (
    node.type !== AST_NODE_TYPES.MemberExpression ||
    node.property.type !== AST_NODE_TYPES.Identifier ||
    node.property.name !== HREF
  )
    return null;
  const { object } = node;
  if (
    object.type !== AST_NODE_TYPES.NewExpression ||
    object.callee.type !== AST_NODE_TYPES.Identifier ||
    object.callee.name !== URL_CLASS
  )
    return null;
  return isImportMetaUrl(object.arguments[1]) ? stringOf(object.arguments[0]) : null;
}

function isMock(callee: Node): boolean {
  return (
    callee.type === AST_NODE_TYPES.MemberExpression &&
    callee.object.type === AST_NODE_TYPES.Identifier &&
    callee.property.type === AST_NODE_TYPES.Identifier &&
    (MOCKS[callee.object.name] ?? []).includes(callee.property.name)
  );
}

/** The relative specifier a mock call names, as a literal or the `import.meta.url` form, or null. */
function mockedPath(node: TSESTree.CallExpression): string | null {
  const [first] = node.arguments;
  if (!isMock(node.callee) || first === undefined) return null;
  const specifier = stringOf(first) ?? urlPath(first);
  return specifier?.startsWith(".") === true ? specifier : null;
}

/**
 * Fails a test that mocks the module it tests: `parse.test.ts` mocking `./parse.ts` checks the mock, not the code.
 * The subject is the test's path minus `.test` or `.spec`, compared without extensions.
 */
export const noMockOfSubject: RepoRule<"subject"> = {
  create(context) {
    const { filename } = context;
    if (!TEST_FILE.test(filename)) return {};
    const subject = filename.replace(TEST_FILE, "");
    return {
      CallExpression(node) {
        const specifier = mockedPath(node);
        if (specifier === null) return;
        if (path.resolve(path.dirname(filename), specifier).replace(EXTENSION, "") !== subject) return;
        context.report({ data: { specifier }, messageId: "subject", node });
      },
    };
  },
  defaultOptions: [],
  meta: {
    messages: {
      subject: '"{{specifier}}" is the module this test covers; test it for real and mock what it calls',
    },
    schema: [],
    type: "problem",
  },
};
