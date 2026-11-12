import { describe, expect, it } from "vitest";

import { reportsOf } from "../../dev/rule-harness.ts";
import { noReflectApply } from "./no-reflect-apply.ts";

const MESSAGE = "Replace `Reflect.apply` with a typed function call. Model dynamic dispatch behind a named interface.";
function messagesOf(code: string) {
  return reportsOf(noReflectApply, { "a.ts": code }).map((report) => report.message);
}

describe("no-reflect-apply", () => {
  it.each([
    "const value = operation.apply(owner, args);",
    "Reflect.get(owner, key);",
    "const Reflect = { apply() { return 1; } }; Reflect.apply();",
    "function invoke(Reflect: { apply(): number }) { return Reflect.apply(); }",
    "export function run() { const Reflect = { apply: () => 1 }; return Reflect.apply(); }",
    "const value = Reflect.apply;",
  ])("passes %j", (code) => {
    expect(messagesOf(code)).toStrictEqual([]);
  });

  it.each([
    ["const value = Reflect.apply(operation, owner, args);", 1],
    ["const value = Reflect['apply'](operation, owner, args);", 1],
    ["const value = Reflect.apply?.(operation, owner, args);", 1],
    [
      "function invoke(Reflect: { apply(): number }) { return Reflect.apply(); }\n" +
        "Reflect.apply(operation, owner, args);",
      1,
    ],
    ["Reflect.apply(first, owner, args);\nReflect.apply(second, owner, args);", 2],
  ] as const)("fails %j once per call", (code, count) => {
    expect(messagesOf(code)).toStrictEqual(Array.from({ length: count }, () => MESSAGE));
  });
});
