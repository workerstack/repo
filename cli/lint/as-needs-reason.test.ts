import type { Context } from "@oxlint/plugins";
import { parseSync } from "oxc-parser";
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
    expect(messagesOf(code)).toStrictEqual([]);
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
    expect(messagesOf(code)).toStrictEqual([needs(type)]);
  });

  it("fails each cast of a statement once", () => {
    expect(messagesOf("export const pair = [a as A, b as const, c as C];")).toStrictEqual([needs("A"), needs("C")]);
  });
});

/** Reports over `code` parsed as oxlint hands it, with no parenthesis nodes: a comment in parentheses follows the expression. */
function unparenthesized(code: string): string[] {
  const messages: string[] = [];
  const { comments, program } = parseSync("a.ts", code, { preserveParens: false });
  const context = {
    report: ({ message }: { message?: string | null }) => messages.push(message ?? ""),
    sourceCode: { getAllComments: () => comments, text: code },
  };
  const visitor = asNeedsReason.create(context as unknown /* a partial double of the context */ as Context);
  const visit = (node: unknown): void => {
    if (typeof node !== "object" || node === null) return;
    if ("type" in node && node.type === "TSAsExpression")
      visitor.TSAsExpression?.(node /* the walk found a cast node */ as never);
    for (const child of Object.values(node)) visit(child);
  };
  visit(program);
  return messages;
}

describe("as-needs-reason with a line reason", () => {
  it.each([
    "export const foo = (\n  value\n  // the schema parsed it above\n) as Foo;",
    "export const foo = (value // the schema parsed it above\n) as Foo;",
  ])("passes %j", (code) => {
    expect(unparenthesized(code)).toStrictEqual([]);
  });

  it.each([
    "export const foo = (value // the schema parsed it above\n  /* ok */) as Foo;",
    "export const foo = (value // why\n) as Foo;",
  ])("fails %j", (code) => {
    expect(unparenthesized(code)).toStrictEqual([needs("Foo")]);
  });
});
