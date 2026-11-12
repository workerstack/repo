import { describe, expect, it } from "vitest";

import { reportsOf } from "../../dev/rule-harness.ts";
import { noUnknownTypeAliases } from "./no-unknown-type-aliases.ts";

function messageOf(alias: string): string {
  return (
    `Type alias \`${alias}\` hides \`unknown\`. Keep \`unknown\` explicit at the parsing boundary or on an allowed ` +
    "`cause` field; otherwise use the parsed owner type."
  );
}

function messagesOf(code: string): string[] {
  return reportsOf(noUnknownTypeAliases, { "a.ts": code }).map((report) => report.message);
}

/** anti-slop's valid cases, then the wrappers that hold an unknown without being one. */
const PASSES = [
  "type User = { readonly id: string };",
  "type Alias = string; type UserId = Alias;",
  "type Payload = string | number;",
  "type Box<T> = { readonly value: T }; type Payload = Box<unknown>;",
  "type Payload = Promise<unknown>;",
  "type Payload = unknown[];",
  "type Payload = string & unknown;",
];

/** anti-slop's invalid cases, each with the alias of every finding. */
const FAILS: [string, string[]][] = [
  ["type Alias = unknown;", ["Alias"]],
  ["type Current = unknown;", ["Current"]],
  ["type UnknownValue = unknown; type Alias = UnknownValue;", ["UnknownValue", "Alias"]],
  ["type Payload = string | unknown;", ["Payload"]],
  ["type Payload = string | unknown; type NestedPayload = number | Payload;", ["Payload", "NestedPayload"]],
  ["type Identity<T> = T; type Payload = Identity<unknown>;", ["Payload"]],
  ["type Identity<T> = T; type Wrapped<T> = Identity<T>; type Payload = Wrapped<unknown>;", ["Payload"]],
  ["function outer() { type Payload = unknown; }", ["Payload"]],
  ["type Payload = (string | (unknown));", ["Payload"]],
];

describe("no-unknown-type-aliases", () => {
  it.each(PASSES)("passes %j", (code) => {
    expect(messagesOf(code)).toStrictEqual([]);
  });

  it.each(FAILS)("fails %j", (code, aliases) => {
    expect(messagesOf(code)).toStrictEqual(aliases.map((alias) => messageOf(alias)));
  });
});
