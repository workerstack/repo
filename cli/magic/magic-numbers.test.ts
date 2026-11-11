import { afterEach, expect, it } from "vitest";

import {
  BOUND,
  cleanTemps,
  hit,
  magicOf,
  NAMES_NOTHING,
  NUMBER,
  SCHEMA,
  STRING,
  COMPARED,
} from "./fixtures/magic-repo.ts";

afterEach(cleanTemps);

const PASS = [
  "export const RETRIES = 3;",
  "export const LIMITS = { name: 64, list: [8, 16] } as const;",
  "export const SIZES = [32, -64] satisfies number[];",
  "export const MINUTE = (60 * 1000) as number;",
  "export enum Level {",
  "  Low = 5,",
  "  High = 10,",
  "}",
  "export class Pool {",
  "  static readonly MAX = 9;",
  "  readonly size = 4;",
  "}",
  "export type Port = 8080;",
  "export type Pair = [3, -4];",
  "type Id = string & { __brand: 'Id' };",
  "export function f(x: number, mode: 'fast' | 'slow', at: `/${string}`, id: Id, s: string): number {",
  "  if (mode === 'fast' || at === '/a' || id !== 'abc') return 0;",
  "  switch (mode) {",
  "    case 'slow':",
  "      return -0;",
  "  }",
  "  if (s === '' || s === '/' || s.split(', ').length === 1) return -0;",
  "  return x * 2 + x / 2 + (x % 2) + 2 ** x + 1;",
  "}",
  "",
].join("\n");

it("passes identity values, scaling 2, named numbers, literal types and typed or punctuation strings", () => {
  expect(magicOf({ "src/pass.ts": PASS })).toStrictEqual([]);
});

const REFUSED = [
  'import { Schema } from "./schema.ts";',
  'import { NAME_MAX } from "./limits.constants.ts";',
  'import { WIDTH } from "@acme/constants";',
  'import * as limits from "./limits.constants.ts";',
  "const LOCAL_MAX = 64;",
  "let loose = 1;",
  "export function g(x: number, s: Schema, kind: string): number {",
  "  void s.max(LOCAL_MAX).max(NAME_MAX).max(WIDTH).min(1).max(x).max(limits.NAME_MAX).max(loose).max(missing);",
  "  switch (kind) {",
  '    case "deep":',
  "      return x + 2;",
  "    default:",
  "      return Math.max(x, 3) - -1;",
  "  }",
  "}",
  "",
].join("\n");

it("refuses -1, a 2 that does not scale, a local const bound, a string case and a bound off a schema", () => {
  expect(
    magicOf({
      "src/limits.constants.ts": "export const NAME_MAX = 2048;\n",
      "src/refused.ts": REFUSED,
      "src/schema.ts": SCHEMA,
    }),
  ).toStrictEqual([
    hit("src/refused.ts:8:14", NUMBER, BOUND(".max(LOCAL_MAX)")),
    hit("src/refused.ts:10:10", STRING, COMPARED("deep")),
    hit("src/refused.ts:11:18", NUMBER, NAMES_NOTHING("2")),
    hit("src/refused.ts:13:26", NUMBER, NAMES_NOTHING("3")),
    hit("src/refused.ts:13:31", NUMBER, NAMES_NOTHING("-1")),
  ]);
});

it("refuses a bound imported from a module that is not a constants file or package", () => {
  const files = {
    "src/a.ts": [
      'import { Schema } from "./schema.ts";',
      'import { MAX } from "./limits.ts";',
      'import { TOP } from "@acme/limits";',
      "export const a = (s: Schema) => s.max(MAX).max(TOP);",
      "",
    ].join("\n"),
    "src/limits.ts": "export const MAX = 64;\n",
    "src/schema.ts": SCHEMA,
  };
  expect(magicOf(files)).toStrictEqual([
    hit("src/a.ts:4:39", NUMBER, BOUND(".max(MAX)")),
    hit("src/a.ts:4:48", NUMBER, BOUND(".max(TOP)")),
  ]);
});
