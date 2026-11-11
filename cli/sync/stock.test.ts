import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { useTempDirs } from "../fixtures/temp-dirs.ts";
import { PACKAGE_NAME } from "./package-name.constants.ts";
import { isSelf, isSelfName, stockRoot } from "./stock.ts";

const { tempDir } = useTempDirs("workerstack-stock-");

function withPackage(text: string | null): string {
  const root = tempDir();
  if (text !== null) fs.writeFileSync(path.join(root, "package.json"), text);
  return root;
}

describe("stockRoot", () => {
  it("is the package under the root's installed modules", () => {
    expect(stockRoot(path.join("a", "b"))).toBe(path.join("a", "b", "node_modules", "@workerstack", "repo"));
  });
});

describe("isSelf", () => {
  it("is true for a package named @workerstack/repo", () => {
    expect(isSelf(withPackage('{"name":"@workerstack/repo"}'))).toBe(true);
  });

  it.each([
    ["another name", '{"name":"fixture"}'],
    ["invalid JSON", "{"],
    ["a non-object", "[]"],
    ["null", "null"],
    ["no package.json", null],
  ])("is false for %s", (_label, text) => {
    expect(isSelf(withPackage(text))).toBe(false);
  });
});

describe("isSelfName", () => {
  it("is true only for the package's own name", () => {
    expect(isSelfName(PACKAGE_NAME)).toBe(true);
    expect(isSelfName("fixture")).toBe(false);
    expect(isSelfName(undefined)).toBe(false);
  });
});
