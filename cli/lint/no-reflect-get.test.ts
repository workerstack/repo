import { describe, expect, it } from "vitest";

import { reportsOf } from "../../dev/rule-harness.ts";
import { noReflectGet } from "./no-reflect-get.ts";

const MESSAGE =
  "Replace `Reflect.get` with typed property access. Parse dynamic input into a named domain type before reading it.";

function messagesOf(code: string) {
  return reportsOf(noReflectGet, { "a.ts": code }).map((report) => report.message);
}

describe("no-reflect-get", () => {
  it.each([
    "const value = owner[key];",
    "Reflect.apply(read, owner, args);",
    "const Reflect = { get() { return 1; } }; Reflect.get();",
    "function read(Reflect: { get(): number }) { return Reflect.get(); }",
    "export function run() { const Reflect = { get: () => 1 }; return Reflect.get(); }",
    "const value = Reflect.get;",
  ])("passes %j", (code) => {
    expect(messagesOf(code)).toStrictEqual([]);
  });

  it.each([
    ["const value = Reflect.get(owner, key);", 1],
    ["const value = Reflect['get'](owner, key);", 1],
    ["const value = Reflect.get?.(owner, key);", 1],
    ["function read(Reflect: { get(): number }) { return Reflect.get(); }\nReflect.get(owner, key);", 1],
    ["Reflect.get(first, key);\nReflect.get(second, key);", 2],
  ] as const)("fails %j once per call", (code, count) => {
    expect(messagesOf(code)).toStrictEqual(Array.from({ length: count }, () => MESSAGE));
  });
});
