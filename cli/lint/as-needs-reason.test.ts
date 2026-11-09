import { describe, expect, it } from "vitest";
import { reportsOf } from "../../dev/rule-harness.ts";
import { asNeedsReason } from "./as-needs-reason.ts";

const needs = (type: string) =>
  `"as ${type}" needs a reason: write x /* why the type holds */ as ${type}, or narrow with a check or a schema parse`;
const messagesOf = (code: string) => reportsOf(asNeedsReason, { "a.ts": code }).map((report) => report.message);

describe("as-needs-reason passes", () => {
  it.each([
    "export const names = ['a', 'b'] as const;",
    "export const raw = JSON.parse('1') as unknown;",
    "export const foo = value /* the schema parsed it above */ as Foo;",
    "export const foo = (value) /* the schema parsed it above */ as Foo;",
    "export const foo = value /* checked by the caller */ /* twice */ as Foo;",
    "export const foo = value /* ok */ /* the schema parsed it above */ as Foo;",
    "export const foo = value as unknown /* the test builds a partial double */ as Foo;",
    "export const foo = {} satisfies Foo;",
    "export const foo = <Foo>value;",
  ])("passes %j", (code) => {
    expect(messagesOf(code)).toEqual([]);
  });
});

describe("as-needs-reason fails", () => {
  it.each([
    ["export const foo = x as Foo;", "Foo"],
    ["export const foo = x as Map<string, Foo[]>;", "Map<string, Foo[]>"],
    ["export const foo = value /* why */ as Foo;", "Foo"],
    ["export const foo = value /* parsed above */ as Foo;", "Foo"],
    ["export const foo = value /**/ as Foo;", "Foo"],
    ["export const foo = value /* ok -- 42 */ as Foo;", "Foo"],
    ["// the schema parsed it above\nexport const foo = value as Foo;", "Foo"],
    ["/* the schema parsed it above */ export const foo = value as Foo;", "Foo"],
    ["export const foo = value as /* the schema parsed it above */ Foo;", "Foo"],
    ["export const foo = value as unknown as Foo;", "Foo"],
  ])("fails %j", (code, type) => {
    expect(messagesOf(code)).toEqual([needs(type)]);
  });

  it("fails each cast of a statement once", () => {
    expect(messagesOf("export const pair = [a as A, b as const, c as C];")).toEqual([needs("A"), needs("C")]);
  });
});
