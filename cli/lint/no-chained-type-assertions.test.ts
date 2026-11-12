import { describe, expect, it } from "vitest";

import { reportsOf } from "../../dev/rule-harness.ts";
import { noChainedTypeAssertions } from "./no-chained-type-assertions.ts";

const MESSAGE =
  "This assertion chain discards type evidence. Keep the original precise type, " +
  "or parse untrusted input at its boundary before narrowing it.";

function messagesOf(code: string) {
  return reportsOf(noChainedTypeAssertions, { "a.ts": code }).map((report) => report.message);
}

const PASSES = [
  "const value = input as User;",
  "const value = (input as User);",
  "const value = <User>input;",
  "const value = ({ id: 1 } as const) as const;",
  "const value = <const>(<const>['a']);",
  // an assertion inside another expression is no link of the outer chain
  "const value = [input as User] as Users;",
  "const value = read(input as Raw) as User;",
  "const value = (input as Raw).user as User;",
  "const value = input satisfies Raw as User;",
];

const FAILS = [
  "const value = input as unknown as User;",
  "const value = (input as unknown) as User;",
  "const value = <User>(<unknown>input);",
  "const value = <User>(input as unknown);",
  "const value = (<unknown>input) as User;",
  "const value = ({ id: 1 } as const) as User;",
  "const value = <const>(input as Raw);",
  // a chain of three is one chain, reported once
  "const value = input as unknown as Raw as User;",
  "export function read(input: string) {\n  return input as unknown as number;\n}",
];

describe("no-chained-type-assertions", () => {
  it.each(PASSES)("passes %j", (code) => {
    expect(messagesOf(code)).toStrictEqual([]);
  });

  it.each(FAILS)("fails %j", (code) => {
    expect(messagesOf(code)).toStrictEqual([MESSAGE]);
  });

  it("reports each chain in a file", () => {
    expect(messagesOf("const a = x as unknown as A;\nconst b = <B>(<unknown>y);")).toStrictEqual([MESSAGE, MESSAGE]);
  });
});
