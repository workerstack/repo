import { describe, expect, it } from "vitest";

import { reportsOf } from "../../dev/rule-harness.ts";
import { noUnsafeDictionaryType } from "./no-unsafe-dictionary-type.ts";

/** The unsafe value kinds the message names. */
type Value = "any" | "empty-object" | "object" | "union" | "unknown";

function messageOf(value: Value): string {
  return (
    `This dictionary's ${value} value type gives callers no concrete value contract. ` +
    "Use an owner/schema-derived value type; parse external payloads before insertion."
  );
}

function messagesOf(code: string): string[] {
  return reportsOf(noUnsafeDictionaryType, { "a.ts": code }).map((report) => report.message);
}

/** anti-slop's valid cases. */
const PASSES = [
  "type Commands = Record<string, Command>;",
  "type Metadata = Record<PropertyKey, JsonValue>;",
  "type PermissionLevels = Record<Permission, number>;",
  "type Indexed = { [key: string]: Command };",
  "type CompatibleIndexes = { [index: number]: Command; [key: string]: Command | OtherCommand };",
  "type Exhaustive = { [K in Permission]: number };",
  "type Allowed = Record<string, { payload: unknown }>;",
  "type AlsoAllowed = Record<string, Result<Data, unknown>>;",
  "type Index<T> = Record<string, T>; type EntityIndex<T extends Entity> = Record<string, T>;",
  "type Safe = Index<Command>; type Index<T> = Record<string, T>;",
  "type A = Map<string, unknown>; type B = ReadonlyMap<string, unknown>; type C = WeakMap<object, unknown>;",
  "import { Record } from './local'; type A = Record<string, unknown>;",
  "type Record<K, V> = { key: K; value: V }; type A = Record<string, unknown>;",
  "type Readonly<T> = { value: T }; type A = Record<string, Readonly<unknown>>;",
  "type NonNullable<T> = { value: T }; type A = Record<string, NonNullable<unknown>>;",
  "type Value<T> = T; type Index<T = Command, U = Value<T>> = Record<string, U>; type A = Index;",
  "interface Owner { readonly id: string } type A = Record<string, unknown & Owner>;",
  "interface Owner { readonly id: string } interface Child extends Owner {} type A = Record<string, Child>;",
  "interface Owner { readonly id: string } interface Child extends Owner { readonly __brand?: never } " +
    "type A = Record<string, Child>;",
  "interface Escape {} interface Escape { readonly id: string } type A = Record<string, Escape>;",
  "interface Escape { readonly id: string } interface Escape {} type A = Record<string, Escape>;",
  "interface Owner { readonly id: string } type A = Record<string, object & Owner>;",
  "type Wrap<T> = { readonly wrapped: T }; type Inner<T, U> = { readonly value: T } & Wrap<U>; " +
    "type Outer<T, U> = Record<string, Inner<T, U>>; declare function f<T, U>(): Outer<T, U>;",
  "type WithSchema<T extends Record<string, unknown>> = (schema: T) => void;",
  "function run<T extends Record<string, unknown>>(input: T): T { return input; }",
  "declare class Store<T extends Record<string, unknown>> { read(): T }",
  "type Deep<T extends Readonly<Record<string, unknown>>> = T;",
  // a qualified name is no local alias or built-in
  "type A = Record<string, Values.Unknown>;",
  "type A = Library.Dictionary;",
  // a wrapper or Record missing the argument that holds the values
  "type A = Record<string, Readonly>;",
  "type A = Readonly;",
  "type A = Record<string>;",
  // an alias missing a required argument stands for nothing
  "type Box<T> = T; type A = Record<string, Box>;",
  "type Index<T> = Record<string, T>; type A = Index;",
  // an alias that expands to itself
  "type Loop = Loop; type A = Record<string, Loop>;",
  "type Loop = Loop; type A = Loop;",
  // a type parameter passed through stays a type parameter
  "type Index<T> = Record<string, T>; declare function f<T>(): Index<T>;",
  // an untyped member or index signature has no value type to judge
  "type A = Record<string, { readonly brand? }>;",
  "type A = { [key: string] };",
  "interface A { [key: string] }",
  "type A = { [K in string] };",
  "interface A { [key: string]: Command }",
  // a type parameter shadows the built-in of its name
  "declare function make<Readonly>(): Record<string, Readonly<unknown>>;",
];

/** anti-slop's invalid cases, each with the value kind of every finding. */
const FAILS: [string, Value[]][] = [
  ["type A = Record<string, unknown>;", ["unknown"]],
  ["type A = { [key: string]: any };", ["any"]],
  ["type A = { [index: number]: Command; [key: string]: unknown | Command };", ["union"]],
  ["type A = { [K in PropertyKey]: object };", ["object"]],
  ["type A = { [K in PropertyKey]: NonNullable<unknown> };", ["unknown"]],
  ["type A = { [key: string]: NonNullable<unknown> };", ["unknown"]],
  ["type A = Record<string, {}>;", ["empty-object"]],
  ["interface Escape {} type A = Record<string, Escape>;", ["empty-object"]],
  ["interface Escape { readonly __brand?: never } type A = Record<string, Escape>;", ["empty-object"]],
  ["type Escape = { readonly __brand?: never }; type A = Record<string, Escape>;", ["empty-object"]],
  ["type A = Record<string, { readonly __brand?: never }>;", ["empty-object"]],
  ["type A = Record<string, string | unknown>;", ["union"]],
  ["interface Escape {} type A = Record<string, string | Escape>;", ["union"]],
  ["type A = Record<string, unknown & {}>;", ["unknown"]],
  ["interface Owner { readonly id: string } type A = Record<string, any & Owner>;", ["any"]],
  ["type Escape = unknown; type A = Record<string, Escape>;", ["unknown"]],
  ["type Dict = Record<string, unknown>;", ["unknown"]],
  ["type A = Readonly<Partial<Required<(Record<string, unknown>)>>>;", ["unknown"]],
  ["type A = { readonly [key: string]: unknown };", ["unknown"]],
  ["type A = { readonly [K in string]: unknown };", ["unknown"]],
  ["type Source = Record<string, unknown>; type A = Pick<Source, string>;", ["unknown", "unknown"]],
  ["type Source = Record<string, unknown>; type A = Omit<Source, never>;", ["unknown", "unknown"]],
  ["type Index<T> = Record<string, T>; type A = Index<unknown>;", ["unknown"]],
  ["interface A { [key: string]: unknown }", ["unknown"]],
  ["type A = Readonly<Record<string, unknown>>;", ["unknown"]],
  ["type A = Record<string, Readonly<unknown>>;", ["unknown"]],
  ["type A = Record<string, Partial<unknown>>;", ["unknown"]],
  ["type A = Record<string, Required<unknown>>;", ["unknown"]],
  ["type Escape = Readonly<unknown>; type A = Record<string, Escape>;", ["unknown"]],
  ["type Wrapped<T> = Readonly<T>; type A = Record<string, Wrapped<unknown>>;", ["unknown"]],
  ["type A = Record<string, NonNullable<unknown>>;", ["unknown"]],
  ["type Escape = NonNullable<unknown>; type A = Record<string, Escape>;", ["unknown"]],
  // a plain use of an unsafe alias reports at the alias, not at each use
  ["type Unsafe = Record<string, unknown>; const x: Unsafe = {}; const y: Unsafe = {};", ["unknown"]],
  ["type Unsafe = Record<string, unknown>; type AlsoUnsafe = Unsafe; const x: Unsafe = {};", ["unknown", "unknown"]],
  ["type Index<T = unknown> = Record<string, T>; type A = Index;", ["unknown"]],
  ["type Index<T, U = T> = Record<string, U>; type A = Index<string, unknown>;", ["unknown"]],
  ["type Index<T, U = T> = Record<string, U>; type A = Index<unknown>;", ["unknown"]],
  ["type Value<T> = T; type Index<T, U = Value<T>> = Record<string, U>; type A = Index<unknown>;", ["unknown"]],
  [
    "type Marker<T> = { readonly __brand?: never }; type Index<T, U = Marker<T>> = Record<string, U>; " +
      "type A = Index<Item>;",
    ["empty-object"],
  ],
  ["function outer() { type Identity<T> = T; type A = Record<string, Identity<unknown>>; }", ["unknown"]],
  [
    "function local() { type Record<K, V> = { key: K; value: V }; type A = Record<string, unknown>; } " +
      "function global() { type A = Record<string, unknown>; }",
    ["unknown"],
  ],
  // an exported interface is still the program's
  ["export interface Escape {} type A = Record<string, Escape>;", ["empty-object"]],
  ["export default interface Escape {} type A = Record<string, Escape>;", ["empty-object"]],
  ["const value = 1; export { value }; type A = Record<string, unknown>;", ["unknown"]],
  ["class A { [key: string]: unknown }", ["unknown"]],
  // a readonly operator, which tsc allows only on arrays and tuples, hides no dictionary and no value
  ["type A = readonly Record<string, unknown>;", ["unknown"]],
  ["type A = Record<string, readonly unknown>;", ["unknown"]],
];

describe("no-unsafe-dictionary-type", () => {
  it.each(PASSES)("passes %j", (code) => {
    expect(messagesOf(code)).toStrictEqual([]);
  });

  it.each(FAILS)("fails %j", (code, values) => {
    expect(messagesOf(code)).toStrictEqual(values.map((value) => messageOf(value)));
  });
});
