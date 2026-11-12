import { expect, it } from "vitest";

import { useTempTree } from "./__fixtures__/temp-tree.ts";
import { ownerLookup } from "./tdd-scope.ts";

const tempTree = useTempTree("owners-");

function tree(files: Record<string, string>): (file: string) => ReturnType<ReturnType<typeof ownerLookup>> {
  return ownerLookup(tempTree(files));
}

it("finds the nearest package.json up to the root, and whether it is private", () => {
  const owner = tree({
    "package.json": "{}",
    "packages/a/package.json": '{ "private": true }',
    "packages/b/package.json": '{ "private": false }',
  });

  expect(owner("packages/a/src/x.ts")).toStrictEqual({ dir: "packages/a", public: false });
  expect(owner("packages/b/x.ts")).toStrictEqual({ dir: "packages/b", public: true });
  expect(owner("cli/x.ts")).toStrictEqual({ dir: ".", public: true });
});

it("treats a file with no manifest, or one it cannot read or parse, as private", () => {
  expect(tree({})("x.ts")).toStrictEqual({ dir: ".", public: false });
  expect(tree({ "a/package.json": "{ nope" })("a/x.ts")).toStrictEqual({ dir: "a", public: false });
});
