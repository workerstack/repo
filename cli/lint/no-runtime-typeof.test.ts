import { describe, expect, it } from "vitest";

import { reportsOf } from "../../dev/rule-harness.ts";
import { noRuntimeTypeof } from "./no-runtime-typeof.ts";

const MESSAGE =
  "A `typeof` check narrows a representation without establishing its contract. " +
  "Parse input at its I/O boundary, then branch on the domain value.";

function messagesOf(code: string): string[] {
  return reportsOf(noRuntimeTypeof, { "a.ts": code }).map((report) => report.message);
}

/** anti-slop's valid cases, the type-predicate ones without an option, then the port's own. */
const PASSES = [
  'const isServer = typeof document === "undefined";',
  'const hasStorage = typeof localStorage !== "undefined";',
  'if (typeof globalThis.crypto === "undefined") throw new Error("no crypto");',
  'const missing = "undefined" === typeof process;',
  "const value = input;",
  'function isString(value: unknown): value is string { return typeof value === "string"; }',
  'const isString = (value: unknown): value is string => typeof value === "string";',
  "function assertString(value: unknown): asserts value is string { " +
    'if (typeof value !== "string") throw new Error(); }',
  // the port's own: the loose probes, a predicate method, a deeper statement in a predicate, a type query, `void`
  'const isServer = typeof document == "undefined";',
  'const hasStorage = typeof localStorage != "undefined";',
  'class Check { isString(value: unknown): value is string { return typeof value === "string"; } }',
  "function isText(value: unknown): value is string { " +
    'if (value === null) return false; return typeof value === "string"; }',
  "const copy: typeof input = input;",
  "const nothing = void input;",
];

/** anti-slop's invalid cases that still fail with type predicates allowed, then the port's own, by finding count. */
const FAILS = [
  ['if (typeof input === "string") use(input);', 1],
  ["if (typeof input === undefined) use(input);", 1],
  ['function parse(value: unknown): string { if (typeof value !== "string") throw new Error(); return value; }', 1],
  [
    "function isString(value: unknown): value is string { " +
      'const check = () => typeof value === "string"; return check(); }',
    1,
  ],
  // the port's own: a bare typeof, another operator, a function without a return type, two in one comparison
  ["const kind = typeof input;", 1],
  ['const before = typeof input < "undefined";', 1],
  ['function isString(value) { return typeof value === "string"; }', 1],
  ['const isString = (value: unknown): boolean => typeof value === "string";', 1],
  ["const same = typeof first === typeof second;", 2],
] as const;

describe("no-runtime-typeof", () => {
  it.each(PASSES)("passes %j", (code) => {
    expect(messagesOf(code)).toStrictEqual([]);
  });

  it.each(FAILS)("fails %j once per typeof", (code, count) => {
    expect(messagesOf(code)).toStrictEqual(Array.from({ length: count }, () => MESSAGE));
  });
});
