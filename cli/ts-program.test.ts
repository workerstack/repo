import { expect, it } from "vitest";

import { posix } from "./ts-program.ts";

it("spells a windows path with forward slashes, as typescript names its files", () => {
  expect(posix("C:\\pkg\\src\\a.ts")).toBe("C:/pkg/src/a.ts");
});

it("leaves a forward-slash path as it is", () => {
  expect(posix("/pkg/src/a.ts")).toBe("/pkg/src/a.ts");
});
