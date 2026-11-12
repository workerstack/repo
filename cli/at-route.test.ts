import { expect, it } from "vitest";

import { atRoute, branchAt, isBranch } from "./at-route.ts";

const MANIFEST = { name: "app", workspaces: { catalog: { a: "1.0.0" }, packages: ["packages/*"] } };

it("isBranch: holds for an object of the tree, not for an array, a primitive, null or a missing value", () => {
  expect(isBranch({})).toBe(true);
  expect(isBranch(["a"])).toBe(false);
  expect(isBranch("a")).toBe(false);
  expect(isBranch(null)).toBe(false);
  expect(isBranch(undefined)).toBe(false);
});

it("atRoute: the value at a path, and undefined past a missing key, an array or a primitive", () => {
  expect(atRoute(MANIFEST, ["workspaces", "catalog", "a"])).toBe("1.0.0");
  expect(atRoute(MANIFEST, [])).toBe(MANIFEST);
  expect(atRoute(MANIFEST, ["workspaces", "catalogs", "next"])).toBeUndefined();
  expect(atRoute(MANIFEST, ["workspaces", "packages", "0"])).toBeUndefined();
  expect(atRoute(MANIFEST, ["name", "length"])).toBeUndefined();
});

it("branchAt: the object at a path, which a write changes, and a detached object where the path holds none", () => {
  const manifest = { catalog: { a: "1.0.0" }, name: "app" };
  branchAt(manifest, ["catalog"])["a"] = "2.0.0";
  branchAt(manifest, ["name"])["a"] = "2.0.0";
  branchAt(manifest, ["missing"])["a"] = "2.0.0";
  expect(manifest).toStrictEqual({ catalog: { a: "2.0.0" }, name: "app" });
});
