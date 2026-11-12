import { describe, expect, it } from "vitest";

import { reportsOf } from "../../dev/rule-harness.ts";
import { noUnknownParameters } from "./no-unknown-parameters.ts";

function messageOf(parameter: string): string {
  return (
    `Parameter \`${parameter}\` leaves input unparsed. Accept a named domain type; ` +
    "run the expected schema or parser at the I/O boundary before calling this function."
  );
}

function messagesOf(code: string): string[] {
  return reportsOf(noUnknownParameters, { "a.ts": code }).map((report) => report.message);
}

/** anti-slop's valid cases, then the unannotated, wrapped and non-unknown parameters the port reads. */
const PASSES = [
  "function enrich(cause: unknown): void {}",
  "function enrich(cause: Error | unknown): void {}",
  "function isString(value: unknown): value is string { return true; }",
  "const isString = (value: unknown): value is string => true;",
  "function assertString(value: unknown): asserts value is string {}",
  "type Guard = (value: unknown) => value is string;",
  "declare function isString(value: unknown): value is string;",
  "type Guards = { isString(value: unknown): value is string };",
  "function parse(value: string | number): void {}",
  // no annotation, an unknown nested in another type, or a predicate on `this` leaves nothing to report
  "function parse(value) {}",
  "function parse(...values) {}",
  "function parse(value = 1) {}",
  "function parse(value: unknown[]): void {}",
  "function parse(value: { cause: unknown }): void {}",
  "function parse(value: Promise<unknown>): void {}",
  "class Box { isFull(value: string): this is Full { return true; } }",
  "function parse(value: string): void {}",
  "class Box { constructor(private readonly cause: unknown) {} }",
];

/** anti-slop's invalid cases, then every other function form and parameter wrapper, each with its parameter names. */
const FAILS: [string, string[]][] = [
  ["function parse(value: unknown): void {}", ["value"]],
  ["function parse(value: string | unknown): void {}", ["value"]],
  ["function parse(value: string | (number | unknown)): void {}", ["value"]],
  ["function isString(value: unknown, context: unknown): value is string { return true; }", ["context"]],
  ["export function parse({ value }: unknown = {}): void {}", ["{ value }"]],
  // a predicate names another parameter or `this`, so neither carves this one out
  ["function isString(other: string, value: unknown): other is string { return true; }", ["value"]],
  ["class Box { isFull(value: unknown): this is Full { return true; } }", ["value"]],
  ["function parse(value: unknown): boolean { return true; }", ["value"]],
  // every wrapper: default, rest, destructured array and parameter property
  ["function parse(value: unknown = 1): void {}", ["value"]],
  ["function parse(...values: unknown[] | unknown): void {}", ["values"]],
  ["function parse([first]: unknown): void {}", ["[first]"]],
  ["class Box { constructor(private readonly value: unknown) {} }", ["value"]],
  // every function form
  ["const parse = (value: unknown) => value;", ["value"]],
  ["const parse = function (value: unknown) { return value; };", ["value"]],
  ["declare function parse(value: unknown): void;", ["value"]],
  ["class Box { parse(value: unknown) {} }", ["value"]],
  ["abstract class Box { abstract parse(value: unknown): void }", ["value"]],
  [
    "interface Box { (value: unknown): void; new (value: unknown): Box; parse(value: unknown): void }",
    ["value", "value", "value"],
  ],
  ["type Parse = (value: unknown) => void;", ["value"]],
  ["type Make = new (value: unknown) => Box;", ["value"]],
];

describe("no-unknown-parameters", () => {
  it.each(FAILS)("fails %j", (code, names) => {
    expect(messagesOf(code)).toStrictEqual(names.map(messageOf));
  });

  it.each(PASSES)("passes %j", (code) => {
    expect(messagesOf(code)).toStrictEqual([]);
  });
});
