import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, expect, it } from "vitest";

import { ownerLookup } from "./tdd-scope.ts";

const temps: string[] = [];
afterEach(() => {
  for (const dir of temps.splice(0)) fs.rmSync(dir, { force: true, recursive: true });
});

function tree(files: Record<string, string>): (file: string) => ReturnType<ReturnType<typeof ownerLookup>> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "owners-"));
  temps.push(root);
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), text);
  }
  return ownerLookup(root);
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
