import { describe, expect, it } from "vitest";

import { reportsOf } from "../../dev/rule-harness.ts";
import { noWidenThenAssert } from "./no-widen-then-assert.ts";

function messageOf(name: string) {
  return (
    `Binding "${name}" discards type evidence and later recreates it with an assertion. ` +
    "Keep the precise type from initialization through use; parse boundary input once."
  );
}

function messagesOf(code: string) {
  return reportsOf(noWidenThenAssert, { "a.ts": code }).map((report) => report.message);
}

/** `statements` as one source, after the `Row` and `Other` type aliases. */
function source(...statements: string[]) {
  return ["type Row = { readonly id: number };", "type Other = { readonly name: string };", ...statements].join("\n");
}

/** A known `source` widened by a const annotated `annotation`, then asserted to `asserted`. */
function rewidened(annotation: string, asserted: string) {
  const widening = `const widened: ${annotation} = source;`;

  return source("const source = { id: 1 };", widening, `const parsed = widened as ${asserted};`);
}

const VALID = [
  "const source = { id: 'first' }; const widened: unknown = source;",
  "declare const input: unknown; const parsed = input as { readonly id: string };",
  // the widened binding holds no known value
  source("declare const input: unknown;", "const widened: unknown = input;", "const parsed = widened as Row;"),
  // object widening asserted to a type that is not definitely an object
  source("const source = { id: 1 };", "const widened: object = source;", "const parsed = widened as string;"),
  // a broad record asserted to a type not known to be narrower and unlike the evidence
  source(
    "const source = { id: 1 } as Row;",
    "const widened: Record<string, unknown> = source;",
    "const parsed = widened as Other;",
  ),
  source(
    "const source = { id: 1 };",
    "const widened: Record<string, unknown> = source;",
    "const parsed = widened as { [key: string]: number };",
  ),
  // the assertion comes before the widening declaration
  source("const source = { id: 1 };", "const early = widened as Row;", "const widened: unknown = source;"),
  // the assertion is in a different function from the widening
  source(
    "const source = { id: 1 };",
    "const widened: unknown = source;",
    "export function read() { return widened as Row; }",
  ),
  // a reassigned let carries no fixed evidence
  source(
    "const source = { id: 1 };",
    "let widened: unknown = source;",
    "widened = 2;",
    "const parsed = widened as Row;",
  ),
  source(
    "let source = { id: 1 };",
    "source = { id: 2 };",
    "const widened: unknown = source;",
    "const parsed = widened as Row;",
  ),
  // the assertion is to another broad type
  source("const source = { id: 1 };", "const widened: unknown = source;", "const parsed = widened as object;"),
  source(
    "const source = { id: 1 };",
    "const widened: unknown = source;",
    "const parsed = widened as Record<string, unknown>;",
  ),
  // nothing declares the asserted binding, or the name it widens
  source("const parsed = missing as Row;"),
  source("const widened: unknown = missing;", "const parsed = widened as Row;"),
  // a parameter, a reassigned const and a call result carry no fixed evidence
  source("export function read(input: unknown) { return input as Row; }"),
  source("const source = { id: 1 };", "const widened: unknown = source;", "widened = 2;", "widened as Row;"),
  source("declare function make(): Row;", "const widened: unknown = make();", "const parsed = widened as Row;"),
  // the evidence was itself widened by an assertion
  source("const source = { id: 1 } as unknown;", "const widened: unknown = source;", "const parsed = widened as Row;"),
  // an index signature whose key is not a broad key does not widen
  rewidened("{ [...key: string[]]: unknown }", "Row"),
  // object widening asserted to a qualified name, record widening asserted to a non-record
  rewidened("object", "Types.Row"),
  rewidened("Record<string, unknown>", "string"),
];

const INVALID = [
  [
    source(
      "const source = { id: 'second' };",
      "const widened: unknown = source;",
      "const parsed = widened as { readonly id: string };",
    ),
    "widened",
  ],
  // object widening asserted to an object type
  [
    source(
      "const source = { id: 1 };",
      "const widened: object = source;",
      "const parsed = widened as { readonly id: number };",
    ),
    "widened",
  ],
  // a broad record asserted to a narrower record
  [
    source(
      "const source = { id: 1 };",
      "const widened: Record<string, unknown> = source;",
      "const parsed = widened as Record<string, number>;",
    ),
    "widened",
  ],
  [
    source(
      "const source = { id: 1 };",
      "const bag: Readonly<Record<string, unknown>> = source;",
      "const parsed = bag as Readonly<Record<string, number>>;",
    ),
    "bag",
  ],
  // the assertion has the same type text as the original evidence
  [
    source(
      "const source = { id: 1 } as Row;",
      "const widened: Record<string, unknown> = source;",
      "const parsed = widened as Row;",
    ),
    "widened",
  ],
  [
    source("const source: Row = { id: 1 };", "const widened: object = source;", "const parsed = widened as Row;"),
    "widened",
  ],
  // widening by an assertion in the initializer, and the angle-bracket assertion form
  [
    source("const source = { id: 1 };", "const widened = source as unknown;", "const parsed = widened as Row;"),
    "widened",
  ],
  [source("const source = { id: 1 };", "const widened: unknown = source;", "const parsed = <Row>widened;"), "widened"],
  // evidence carried through another const
  [
    source(
      "const source = { id: 1 };",
      "const alias = source;",
      "const widened: unknown = alias;",
      "const parsed = widened as Row;",
    ),
    "widened",
  ],
  // widening and assertion inside one function
  [
    source(
      "export function read() {",
      "  const source = { id: 1 };",
      "  const widened: unknown = source;",
      "  return widened as Row;",
      "}",
    ),
    "widened",
  ],
  // broad records keyed by a union of keys or by PropertyKey
  [rewidened("Record<string | number, unknown>", "Record<string, number>"), "widened"],
  [rewidened("Record<PropertyKey, unknown>", "Record<string, number>"), "widened"],
  // object widening asserted to an array, an intersection of object literals and a readonly array
  [rewidened("object", "Row[]"), "widened"],
  [rewidened("object", "{ id: number } & { name: string }"), "widened"],
  [rewidened("object", "readonly number[]"), "widened"],
] as const;

describe("no-widen-then-assert", () => {
  it.each(VALID)("passes %j", (code) => {
    expect(messagesOf(code)).toStrictEqual([]);
  });

  it.each(INVALID)("fails %j", (code, name) => {
    expect(messagesOf(code)).toStrictEqual([messageOf(name)]);
  });
});
