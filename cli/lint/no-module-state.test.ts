import { describe, expect, it } from "vitest";

import { reportsOf } from "../../dev/rule-harness.ts";
import { noModuleState } from "./no-module-state.ts";

const MESSAGE =
  "module-scope state outlives every caller; move it into a function, or make it a const with a Readonly type";
const messagesOf = (code: string) => reportsOf(noModuleState, { "a.ts": code }).map((report) => report.message);

describe("no-module-state passes", () => {
  it.each([
    "export const LIMIT = 3;",
    "const NAMES = ['a', 'b'] as const;",
    "const config = { retries: 2 };",
    "const seen: ReadonlySet<string> = new Set(['a']);",
    "export const byId: ReadonlyMap<string, number> = new Map();",
    "const box: Readonly<Box> = new Box();",
    "export function count() { let n = 0; n += 1; return n; }",
    "function make() { var cache = new Map(); return cache; }",
    "class Cache { items = new Map(); }",
    "declare let injected: string;",
  ])("passes %j", (code) => {
    expect(messagesOf(code)).toStrictEqual([]);
  });
});

describe("no-module-state fails", () => {
  it.each([
    "let count = 0;",
    "var count = 0;",
    "export let count = 0;",
    "using handle = open();",
    "const cache = new Map();",
    "export const cache = new Map<string, number>();",
    "const cache = (new Map());",
    "const cache = new Map() as Map<string, number>;",
    "const cache = new Map() satisfies Map<string, number>;",
    "const cache = new Map()!;",
    "const cache = <Map<string, number>>new Map();",
    "const cache = ((new Map() as Map<string, number>)!) satisfies object;",
    "const cache: Map<string, number> = new Map();",
    "const cache: Set<string> & Readonly<object> = new Set();",
    "const cache: Types.Readonly = new Box();",
    "const LIMIT = 3, cache = new Map();",
    "// per-process-constant: build id\nlet buildId = '';",
  ])("fails %j once", (code) => {
    expect(messagesOf(code)).toStrictEqual([MESSAGE]);
  });
});
