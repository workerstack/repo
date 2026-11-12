import { describe, expect, it } from "vitest";

import { reportsOf } from "../../dev/rule-harness.ts";
import { noObjectParameters } from "./no-object-parameters.ts";

function messageOf(parameter: string) {
  return (
    `Parameter \`${parameter}\` uses the broad \`object\` type. Accept a named owner type; ` +
    "parse external input at its boundary before calling this function."
  );
}

function messagesOf(code: string) {
  return reportsOf(noObjectParameters, { "a.ts": code }).map((report) => report.message);
}

const PASSES = [
  "type Alias = object;",
  "function f(value: Alias) {}",
  "interface Owner { readonly id: string } function f(value: Owner) {}",
  "function f<Value>(value: Value) {}",
  "function f<Value extends object>(value: Value) {}",
  "function f<Value extends Owner, Owner extends { readonly id: string }>(value: Value) {}",
  "type Owner = { readonly id: string }; function f<Value extends Owner>(value: Value) {}",
  "function f(value: object[]) {}",
  "function f(value: Record<string, unknown>) {}",
  "function f(...values) {}",
  "function f(value) {}",
  "const value: object = {};",
  // a type parameter, a mapped key or an infer binder shadows the module alias
  "type Alias = object; function consume<Alias>(value: Alias) {}",
  "type Alias = object; type Consumer<Alias> = (value: Alias) => void;",
  "type Alias = object; interface Consumer<Alias> { consume(value: Alias): void }",
  "type Alias = object; class Consumer<Alias> { consume(value: Alias) {} }",
  "type Key = object; type Mapped<Input> = { [Key in keyof Input]: (value: Key) => void };",
  "type Key = object; type Mapped<Input> = " +
    "{ [Key in keyof Input as ((value: Key) => void) extends Key ? Key : never]: 1 };",
  "type Item = object; type Unpacked<Input> = Input extends Promise<infer Item> ? (value: Item) => void : never;",
  "type Identity<T> = T; function consume<Identity>(value: Identity) {}",
  // a nearer declaration of the name shadows the module alias
  "type Payload = object; " +
    "function outer() { type Payload = { readonly id: string }; function consume(value: Payload) {} }",
  "type Alias = object; function outer() { interface Alias { id: string } function f(value: Alias) {} }",
  "type Alias = object; function outer() { class Alias {} function f(value: Alias) {} }",
  "type Alias = object; function outer() { enum Alias { A } function f(value: Alias) {} }",
  "import type { Alias } from './alias'; function f(value: Alias) {}",
  "import Alias from './alias'; function f(value: Alias) {}",
  "import * as Alias from './alias'; function f(value: Alias) {}",
  // an alias out of scope, an ambiguous name and a qualified name resolve to nothing
  "function one() { type Payload = object; } function two() { function consume(value: Payload) {} }",
  "interface Alias {} type Alias = object; function f(value: Alias) {}",
  "function f(value: Types.Alias) {}",
  "export const make = class { run(value: string) {} };",
  // an alias the resolver cannot finish: a cycle, a missing argument, a type parameter given arguments
  "type Loop = Loop; function f(value: Loop) {}",
  "type Pair<A, B> = A | B; function f(value: Pair<string>) {}",
  "type Alias = object; type Wrap<Alias> = Alias<string>; function f(value: Wrap<number>) {}",
];

const FAILS = [
  ["function f(value: object) {}", "value"],
  ["function f(value?: object) {}", "value"],
  ["function f(...value: object) {}", "value"],
  ["function f(value: string | object) {}", "value"],
  ["type Alias = object; function f(value: Alias) {}", "value"],
  ["type Alias = (object); function f(value: Alias) {}", "value"],
  ["type Alias = string | (number | object); function f(value: Alias) {}", "value"],
  ["type Item = object; type Fallback<Input> = Input extends infer Item ? string : (value: Item) => void;", "value"],
  ["type Key = object; type Mapped = { [Key in Parameters<(value: Key) => void>[0] & string]: 1 };", "value"],
  ["function consume(value: object = {}): void {}", "value"],
  // a destructured parameter is named by its pattern
  ["function consume({ value }: object = {}): void {}", "{ value }"],
  ["type Bag = object; function consume({ value }: Bag): void {}", "{ value }"],
  ["function consume([first, second]: object): void {}", "[first, second]"],
  ["function consume(...[first]: object): void {}", "[first]"],
  // the alias is visible from a block, before or after the use
  ["function outer() { type Payload = object; function consume(value: Payload) {} }", "value"],
  ["function outer() { function consume(value: Payload) {} type Payload = object; }", "value"],
  ["namespace N { type Alias = object; function f(value: Alias) {} }", "value"],
  ["class A { static { type Alias = object; function f(value: Alias) {} } }", "value"],
  ["switch (key) { case 1: type Alias = object; function f(value: Alias) {} }", "value"],
  // generic aliases substitute their arguments and defaults
  ["type Identity<T> = T; function consume(value: Identity<object>) {}", "value"],
  ["type Identity<T> = T; type Wrapped<T> = Identity<T>; function consume(value: Wrapped<object>) {}", "value"],
  ["type Maybe<T = object> = T; function consume(value: Maybe) {}", "value"],
  ["type Second<A, B = A> = B; function consume(value: Second<object>) {}", "value"],
  // every function and signature owner
  ["declare function f(value: object): void;", "value"],
  ["const f = (value: object) => {};", "value"],
  ["const f = function (value: object) {};", "value"],
  ["class A { run(value: object) {} }", "value"],
  ["class A { constructor(private value: object) {} }", "value"],
  ["class A { constructor(readonly value: object = {}) {} }", "value"],
  ["abstract class A { abstract run(value: object): void; }", "value"],
  ["interface A { run(value: object): void }", "value"],
  ["interface A { (value: object): void }", "value"],
  ["interface A { new (value: object): A }", "value"],
  ["type F = (value: object) => void;", "value"],
  ["type C = new (value: object) => A;", "value"],
  ["const handlers = { run(value: object) {} };", "value"],
] as const;

describe("no-object-parameters", () => {
  it.each(PASSES)("passes %j", (code) => {
    expect(messagesOf(code)).toStrictEqual([]);
  });

  it.each(FAILS)("fails %j", (code, parameter) => {
    expect(messagesOf(code)).toStrictEqual([messageOf(parameter)]);
  });

  it("reports each object parameter once, by its own name", () => {
    expect(messagesOf("function f(a: object, b: string, c: object) {}")).toStrictEqual([
      messageOf("a"),
      messageOf("c"),
    ]);
  });

  it("reports an overload and its implementation each", () => {
    expect(messagesOf("class A { run(value: object): void; run(value: object) {} }")).toStrictEqual([
      messageOf("value"),
      messageOf("value"),
    ]);
  });
});
