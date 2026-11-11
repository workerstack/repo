import path from "node:path";

import type { ESTree, CreateRule } from "@oxlint/plugins";

const TEST_FILE = /\.(?:test|spec)(\.[cm]?[jt]sx?)$/;
const EXTENSION = /\.[cm]?[jt]sx?$/;
/** `vi.mock`, `vi.doMock` and `jest.mock` replace a module for the whole test file. */
const MOCKS: Readonly<Record<string, readonly string[]>> = { jest: ["mock"], vi: ["mock", "doMock"] };

type Node = ESTree.Node;

const stringOf = (node: Node | undefined): string | null =>
  node?.type === "Literal" && typeof node.value === "string" ? node.value : null;

const isImportMetaUrl = (node: Node | undefined): boolean =>
  node?.type === "MemberExpression" &&
  node.object.type === "MetaProperty" &&
  node.object.meta.name === "import" &&
  node.property.type === "Identifier" &&
  node.property.name === "url";

/** The relative path of `new URL("<rel>", import.meta.url).href`, or null for any other node. */
function urlPath(node: Node): string | null {
  if (node.type !== "MemberExpression" || node.property.type !== "Identifier" || node.property.name !== "href")
    return null;
  const { object } = node;
  if (object.type !== "NewExpression" || object.callee.type !== "Identifier" || object.callee.name !== "URL")
    return null;
  return isImportMetaUrl(object.arguments[1]) ? stringOf(object.arguments[0]) : null;
}

const isMock = (callee: Node): boolean =>
  callee.type === "MemberExpression" &&
  callee.object.type === "Identifier" &&
  callee.property.type === "Identifier" &&
  (MOCKS[callee.object.name] ?? []).includes(callee.property.name);

/** The relative specifier a mock call names, as a literal or the `import.meta.url` form, or null. */
function mockedPath(node: ESTree.CallExpression): string | null {
  const [first] = node.arguments;
  if (!isMock(node.callee) || first === undefined) return null;
  const specifier = stringOf(first) ?? urlPath(first);
  return specifier?.startsWith(".") ? specifier : null;
}

/**
 * Fails a test that mocks the module it tests: `parse.test.ts` mocking `./parse.ts` checks the mock, not the code.
 * The subject is the test's path minus `.test` or `.spec`, compared without extensions.
 */
export const noMockOfSubject: CreateRule = {
  create(context) {
    const { filename } = context;
    if (!TEST_FILE.test(filename)) return {};
    const subject = filename.replace(TEST_FILE, "");
    return {
      CallExpression(node) {
        const specifier = mockedPath(node);
        if (specifier === null) return;
        if (path.resolve(path.dirname(filename), specifier).replace(EXTENSION, "") !== subject) return;
        const message = `"${specifier}" is the module this test covers; test it for real and mock what it calls`;
        context.report({ message, node });
      },
    };
  },
};
