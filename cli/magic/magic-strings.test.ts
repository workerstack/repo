import { afterEach, expect, it } from "vitest";

import { cleanTemps, COMPARED, COPIES, hit, magicOf, STRING } from "./fixtures/magic-repo.ts";

afterEach(cleanTemps);

it("refuses a string compared to string | undefined, unknown or any, from either side", () => {
  const kinds = [
    "export function k(a: string | undefined, b: 'a' | null, c: unknown, d: any): boolean {",
    "  return a === 'on' || b === 'a' || 'on' !== c || d != `on`;",
    "}",
    "",
  ].join("\n");
  expect(magicOf({ "src/kinds.ts": kinds })).toStrictEqual([
    hit("src/kinds.ts:2:16", STRING, COMPARED("on")),
    hit("src/kinds.ts:2:37", STRING, COMPARED("on")),
    hit("src/kinds.ts:2:56", STRING, COMPARED("on")),
  ]);
});

it("reports a const copy once at its declaration, through an import alias, and not one in a constants file", () => {
  const files = {
    "src/modes.constants.ts": 'export const QUICK = "quick";\n',
    "src/modes.ts": 'export const SLOW = "slow";\nexport const LAZY = ("lazy") as const;\nexport const SEP = "/";\n',
    "src/use.ts": [
      'import { LAZY, SEP, SLOW as S } from "./modes.ts";',
      'import { QUICK } from "./modes.constants.ts";',
      "let late = 'x';",
      "const N = 5;",
      "export const is = (m: string, n: number) =>",
      "  m === S || m == S || m === LAZY || m === QUICK || m === SEP || m === late || n === N || m === undefined;",
      "",
    ].join("\n"),
  };
  expect(magicOf(files)).toStrictEqual([
    hit("src/modes.ts:1:14", STRING, COPIES("SLOW", "slow")),
    hit("src/modes.ts:2:14", STRING, COPIES("LAZY", "lazy")),
  ]);
});
