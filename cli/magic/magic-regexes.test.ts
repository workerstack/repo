import { afterEach, expect, it } from "vitest";

import { cleanTemps, hit, inlineRegex, magicOf, REGEX } from "./__fixtures__/magic-repo.ts";

afterEach(cleanTemps);

it("refuses a regex literal and new RegExp of a literal pattern inside a function, and RegExp without new", () => {
  const source = [
    "export function version(text: string): boolean {",
    "  return /^v\\d+/.test(text);",
    "}",
    "export const build = (text: string) => new RegExp('x').test(text) || RegExp(`y`).test(text);",
    "",
  ].join("\n");

  expect(magicOf({ "src/a.ts": source })).toStrictEqual([
    hit("src/a.ts:2:10", REGEX, inlineRegex("/^v\\d+/")),
    hit("src/a.ts:4:40", REGEX, inlineRegex("new RegExp('x')")),
    hit("src/a.ts:4:70", REGEX, inlineRegex("RegExp(`y`)")),
  ]);
});

it("passes a module const, a class field, a dynamic pattern, a RegExp with no pattern and a constants file", () => {
  const files = {
    "src/a.constants.ts": "export function make(): RegExp {\n  return /^v\\d+/;\n}\n",
    "src/a.ts": [
      "const VERSION = /^v\\d+/;",
      "export class Matcher {",
      "  pattern = /x/;",
      "}",
      "export function dynamic(name: string): RegExp {",
      "  return new RegExp(name);",
      "}",
      "export function empty(): RegExp {",
      "  return new RegExp;",
      "}",
      "export const test = (text: string) => VERSION.test(text);",
      "",
    ].join("\n"),
  };

  expect(magicOf(files)).toStrictEqual([]);
});

it("passes the root repo.config.ts, which holds values by definition", () => {
  const config = "export default function config(): RegExp {\n  return /x/;\n}\n";
  expect(magicOf({ "repo.config.ts": config })).toStrictEqual([]);
});

it("passes a test file, whose regex is its expectation", () => {
  const test = "export function expected(): RegExp {\n  return /x/;\n}\n";
  expect(magicOf({ "src/a.test.ts": test })).toStrictEqual([]);
});
