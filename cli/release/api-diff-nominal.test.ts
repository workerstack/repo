import { expect, it } from "vitest";

import { defined, nodeOf, typeOf } from "./api-diff-nominal.ts";

it("tells a value from undefined", () => {
  expect(defined(0)).toBe(true);
  expect(defined(undefined)).toBe(false);
});

it("refuses a symbol TypeScript gives no type, by name", async () => {
  const ctx = { project: { checker: { getTypeOfSymbol: () => Promise.resolve(undefined) } } };

  await expect(typeOf(ctx, { name: "lost" })).rejects.toThrow("TypeScript gave no type for lost");
});

it("refuses a declaration TypeScript cannot find, by file", async () => {
  const handle = { path: "/p/a.d.ts", resolve: () => Promise.resolve(undefined) };

  await expect(nodeOf({ project: {} }, handle)).rejects.toThrow("TypeScript found no declaration in /p/a.d.ts");
});
