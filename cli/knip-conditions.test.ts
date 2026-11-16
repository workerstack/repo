import { afterEach, expect, it } from "vitest";

import { knipRoot, removeKnipRoots } from "./__fixtures__/knip-run.ts";
import { conditionedArgs, customConditionsOf } from "./knip-conditions.ts";

afterEach(removeKnipRoots);

it("collects each tsconfig.json's customConditions, root first, once each, and skips one with none or no file", () => {
  const ws = knipRoot({
    "packages/a/tsconfig.json":
      '{\n  // the source build\n  "compilerOptions": { "customConditions": ["source", "dev"] }\n}\n',
    "packages/b/tsconfig.json": '{ "compilerOptions": { "strict": true } }\n',
    "packages/c/package.json": "{}\n",
    "packages/d/tsconfig.json": '{ "compilerOptions": { "customConditions": "source" } }\n',
    "tsconfig.json": '{ "compilerOptions": { "customConditions": ["source"] } }\n',
  });

  const packages = ["a", "b", "c", "d"].map((name) => ({ dir: `packages/${name}`, manifest: {} }));
  expect(customConditionsOf({ ...ws, packages })).toStrictEqual(["source", "dev"]);
});

it("finds no condition in a workspace with no tsconfig.json", () => {
  expect(customConditionsOf(knipRoot({}))).toStrictEqual([]);
});

it("puts one --conditions flag per condition before the bin and its arguments", () => {
  expect(conditionedArgs(["source", "dev"], "/knip.js", ["--reporter", "json"])).toStrictEqual([
    "--conditions=source",
    "--conditions=dev",
    "/knip.js",
    "--reporter",
    "json",
  ]);
  expect(conditionedArgs([], "/knip.js", [])).toStrictEqual(["/knip.js"]);
});
