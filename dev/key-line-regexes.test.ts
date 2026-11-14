import { expect, it } from "vitest";

import { crossesAfterKey, keyLineRegexes } from "./key-line-regexes.ts";
import { scanTree } from "./source-scan.ts";

it("flags \\s right after a key's colon or equals sign, and not after a group opener or inside a class", () => {
  expect(["^a:\\s*(.+)$", "^name\\s*=\\s+x", "b:\\s", "x?:\\s"].map(crossesAfterKey)).toStrictEqual([
    true,
    true,
    true,
    true,
  ]);
  expect(
    ["^a:[ \\t]*(.+)$", "^(?:\\s|x)", "(?=\\s)", "(?<=\\s)", "[:\\s]+", "a\\:x", "^\\s*a:"].map(crossesAfterKey),
  ).toStrictEqual([false, false, false, false, false, false, false]);
});

it("finds multi-line literals and RegExp calls, a template one too, and no regex without m or in a string", () => {
  const source = [
    "const a = /^KEY:\\s*(.+)$/m;",
    "const b = /^KEY:\\s*(.+)$/;",
    'const c = new RegExp(`^${key}:\\\\s*(\\\\S+)`, "m");',
    'const d = RegExp("^x:\\\\s+(\\\\d+)", "gm");',
    'const e = new RegExp("^x:\\\\s+", flags);',
    'const f = "/^KEY:\\\\s*(.+)$/m";',
    "const g = /^KEY:[ \\t]*(.+)$/m;",
  ].join("\n");

  expect(keyLineRegexes("x.ts", source)).toStrictEqual([1, 3, 4]);
});

it("finds no key-line regex whose space after the key crosses a line; use [ \\t]", () => {
  expect(scanTree(keyLineRegexes)).toStrictEqual([]);
});
