import { expect, it } from "vitest";

import { posix, setupOf } from "./ts-program.ts";
import { RUNTIME_CONFIG } from "./tsconfig.constants.ts";

it("spells a windows path with forward slashes, as typescript names its files", () => {
  expect(posix("C:\\pkg\\src\\a.ts")).toBe("C:/pkg/src/a.ts");
});

it("leaves a forward-slash path as it is", () => {
  expect(posix("/pkg/src/a.ts")).toBe("/pkg/src/a.ts");
});

it("checks a file with no tsconfig.json above it strict, resolved as a bundler would, with no files listed", () => {
  expect(setupOf("/pkg", null, RUNTIME_CONFIG)).toMatchObject({
    ok: true,
    value: { fileNames: [], options: { allowImportingTsExtensions: true, noEmit: true, strict: true } },
  });
});
