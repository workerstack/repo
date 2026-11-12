import { describe, expect, it } from "vitest";

import { reportsOf } from "../../dev/rule-harness.ts";
import { noForbiddenTermInSymbolNames } from "./no-forbidden-term-in-symbol-names.ts";

function messageOf(name: string): string {
  return `Rename symbol "${name}" for its domain role; "shape" describes structure rather than ownership.`;
}

function messagesOf(code: string, file = "a.ts") {
  return reportsOf(noForbiddenTermInSymbolNames, { [file]: code }).map((report) => report.message);
}

const PASSES = [
  "declare const schema: ExternalSchema; const field = schema.shape.id;",
  "declare const outer: External; const value = outer.inner.shape;",
  "declare const schema: ExternalSchema; schema.shape.id.parse('x');",
  "const owner = { id: 1 }; const value = owner.id;",
  "declare const schema: ExternalSchema; const field = schema?.shape;",
  // prose holding the word is no symbol
  '// the shape of a row\nconst row = "shape";',
];

const FAILS: [string, string[]][] = [
  ["const shape = 1;", ["shape"]],
  ["function shapeOf() {}", ["shapeOf"]],
  ["type PayloadShape = { id: string };", ["PayloadShape"]],
  ["type Payload = { shape: string };", ["shape"]],
  ["const TOKEN_SHAPE = /x/;", ["TOKEN_SHAPE"]],
  ["const USER_SHAPED = 1;", ["USER_SHAPED"]],
  ["const sHaPe = 1;", ["sHaPe"]],
  ["class Box { #shape = 1; }", ["shape"]],
  ["const payload = { shape: 1 };", ["shape"]],
  // a computed member reads the binding, so it is no borrowed name
  ["declare const owner: External; const shape = 'field'; const value = owner[shape];", ["shape", "shape"]],
  // a declaration and each use report
  ["const shape = 1;\nexport const twice = shape + shape;", ["shape", "shape", "shape"]],
  // a member's object is a use of the binding
  ["declare const shape: External; const field = shape.id;", ["shape", "shape"]],
];

describe("no-shape-in-symbol-names", () => {
  it.each(PASSES)("passes %j", (code) => {
    expect(messagesOf(code)).toStrictEqual([]);
  });

  it.each(FAILS)("fails %j", (code, names) => {
    expect(messagesOf(code)).toStrictEqual(names.map((name) => messageOf(name)));
  });

  it("fails a JSX name holding shape", () => {
    expect(messagesOf("export const view = <Shape />;", "a.tsx")).toStrictEqual([messageOf("Shape")]);
  });

  it("passes a JSX name without it", () => {
    expect(messagesOf("export const view = <Box />;", "a.tsx")).toStrictEqual([]);
  });
});
