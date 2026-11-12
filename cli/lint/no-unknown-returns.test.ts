import { describe, expect, it } from "vitest";

import { reportsOf } from "../../dev/rule-harness.ts";
import { noUnknownReturns } from "./no-unknown-returns.ts";

const MESSAGE =
  "This function exposes `unknown` to its caller. Parse the value at its boundary and return a named domain type.";

function messagesOf(code: string): string[] {
  return reportsOf(noUnknownReturns, { "a.ts": code }).map((report) => report.message);
}

/** anti-slop's valid cases, then the wrappers, names and members the port reads. */
const PASSES = [
  "type ImportedValue = unknown;",
  "function parse(): ImportedValue { return input; }",
  "function parse(): User { return user; }",
  "function infer() { return input; }",
  "function generic<Value>(): Value { return value; }",
  "type Value = unknown; function generic<Value>(): Value { return value; }",
  "type Key = unknown; type Mapped<Input> = { [Key in keyof Input]: () => Key };",
  "type Item = unknown; type Unpacked<Input> = Input extends Promise<infer Item> ? () => Item : never;",
  "function cause(): { cause: unknown } { return { cause: input }; }",
  "type Result = { value: unknown }; function load(): Result { return result; }",
  "function load(): Promise<User> { return promise; }",
  "type Identity<T> = T; function load(): Identity<User> { return user; }",
  "type Value = unknown; function outer() { type Value = User; function load(): Value { return user; } }",
  // a promise with no value type, a qualified name or another generic holds no unknown result
  "function load(): Promise { return promise; }",
  "function load(): Library.Promise<unknown> { return promise; }",
  "function load(): Array<unknown> { return []; }",
  "function load(): unknown[] { return []; }",
  // a member, signature or callback with no return annotation exposes nothing
  "interface Loader { load(); new (); () }",
  "class Loader { load() { return input; } }",
  "const load = () => input;",
];

/** anti-slop's invalid cases, then every other function form, each with its finding count. */
const FAILS: [string, number][] = [
  ["function load(): unknown { return input; }", 1],
  ["const load = (): unknown => input;", 1],
  ["type Loader = () => unknown;", 1],
  ["interface Loader { load(): unknown }", 1],
  ["declare function load(): unknown;", 1],
  ["function load(): string | unknown { return input; }", 1],
  ["function load(): Promise<unknown> { return promise; }", 1],
  ["type UnknownValue = unknown; function load(): UnknownValue { return input; }", 1],
  ["type Item = unknown; type Fallback<Input> = Input extends infer Item ? string : () => Item;", 1],
  ["function outer() { type Result = unknown; function load(): Result { return input; } }", 1],
  ["type Identity<T> = T; function load(): Identity<unknown> { return input; }", 1],
  [
    "type Identity<T> = T; type Wrapped<T> = Promise<Identity<T>>; " +
      "function load(): Wrapped<unknown> { return promise; }",
    1,
  ],
  ["function load(): PromiseLike<unknown> { return promise; }", 1],
  ["function load(): Promise<string | (unknown)> { return promise; }", 1],
  ["const load = function (): unknown { return input; };", 1],
  ["class Loader { load(): unknown { return input; } }", 1],
  ["declare class Loader { load(): unknown }", 1],
  ["abstract class Loader { abstract load(): unknown }", 1],
  ["interface Loader { (): unknown; new (): unknown }", 2],
  ["type Make = new () => unknown;", 1],
];

describe("no-unknown-returns", () => {
  it.each(PASSES)("passes %j", (code) => {
    expect(messagesOf(code)).toStrictEqual([]);
  });

  it.each(FAILS)("fails %j", (code, count) => {
    expect(messagesOf(code)).toStrictEqual(Array.from({ length: count }, () => MESSAGE));
  });
});
