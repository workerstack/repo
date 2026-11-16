import { describe, expect, it } from "vitest";

import { fixedOf, reportsOf } from "../../dev/rule-harness.ts";
import { consistentTypeDefinitions } from "./consistent-type-definitions.ts";

function countOf(code: string): number {
  return reportsOf(consistentTypeDefinitions, { "a.ts": code }).length;
}

describe("consistent-type-definitions", () => {
  it.each([
    ['declare module "x" {\n  interface A {\n    a: string;\n  }\n}\n\nexport {};\n'],
    ["declare global {\n  interface Window {\n    a: string;\n  }\n}\n\nexport {};\n"],
    ["declare namespace N {\n  interface A {\n    a: string;\n  }\n}\n\nexport {};\n"],
    ["interface A {\n  a: string;\n}\n"],
  ])("does not report or fix an interface that may augment: %j", (code) => {
    expect(countOf(code)).toBe(0);
    expect(fixedOf(consistentTypeDefinitions, code)).toBe(code);
  });
});

describe("consistent-type-definitions merging", () => {
  it.each([
    ["export interface A {\n  a: string;\n}\n\nexport class A {}\n"],
    ["export class A {}\n\ninterface A {\n  a: string;\n}\n"],
    ["export interface A {\n  a: string;\n}\n\nexport interface A {\n  b: string;\n}\n"],
    ["export function A(): void {}\n\nexport interface A {\n  a: string;\n}\n"],
    ["export interface A {\n  a: string;\n}\n\nexport namespace A {}\n"],
  ])("does not report or fix an interface that merges with another declaration of its name: %j", (code) => {
    expect(countOf(code)).toBe(0);
    expect(fixedOf(consistentTypeDefinitions, code)).toBe(code);
  });

  it.each([
    ["export default class A {}\n\ninterface A {\n  a: string;\n}\n"],
    ["export function f(): void {\n  class A {}\n\n  interface A {\n    a: string;\n  }\n}\n"],
  ])("does not report or fix an interface merged in a default export or a block: %j", (code) => {
    expect(countOf(code)).toBe(0);
  });

  it.each([
    ["const x = 1;\nexport { x };\nexport interface A { a: string }\n"],
    ["export default class {}\nexport interface A { a: string }\n"],
    ['declare module "y" {}\nexport interface A { a: string }\n'],
    ["export function f(x: number): void {\n  switch (x) {\n    case 1:\n      interface A { a: string }\n  }\n}\n"],
  ])("still reports an interface no declaration of its name sits beside: %j", (code) => {
    expect(countOf(code)).toBe(1);
  });

  it("still reports an interface whose name only a declaration in another scope shares", () => {
    expect(countOf("export interface A { a: string }\nexport function f(): void {\n  class A {}\n}\n")).toBe(1);
  });
});

describe("consistent-type-definitions fixes", () => {
  it("rewrites a plain generic interface in a module", () => {
    const code = "interface Box<T> { value: T }\nexport {};\n";
    expect(countOf(code)).toBe(1);
    expect(fixedOf(consistentTypeDefinitions, code)).toBe("type Box<T> = { value: T };\nexport {};\n");
  });

  it("rewrites an interface that extends as an intersection", () => {
    const code = "interface A { a: string }\ninterface B extends A { b: number }\nexport {};\n";
    expect(countOf(code)).toBe(2);
    expect(fixedOf(consistentTypeDefinitions, code)).toBe(
      "type A = { a: string };\ntype B = A & { b: number };\nexport {};\n",
    );
  });

  it("rewrites a generic interface that extends, keeping its type parameters", () => {
    const code = "interface A { a: string }\ninterface C<T> extends A { c: T }\nexport {};\n";
    expect(countOf(code)).toBe(2);
    expect(fixedOf(consistentTypeDefinitions, code)).toBe(
      "type A = { a: string };\ntype C<T> = A & { c: T };\nexport {};\n",
    );
  });
});

describe("consistent-type-definitions exports", () => {
  it.each([
    ["export default interface A { a: string }\n"],
    ["export interface A { a: string }\n"],
    ["interface A { a: string }\nexport { A };\n"],
    ["interface A { a: string }\nexport default A;\n"],
  ])("reports an interface another module may augment and does not fix it: %j", (code) => {
    expect(countOf(code)).toBe(1);
    expect(fixedOf(consistentTypeDefinitions, code)).toBe(code);
  });

  it.each([
    ['interface A { a: string }\nexport { A as B } from "./b.ts";\nexport default 1;\n'],
    ['interface A { a: string }\nexport { "A" as B } from "./b.ts";\n'],
  ])("fixes an interface the module does not export: %j", (code) => {
    expect(fixedOf(consistentTypeDefinitions, code)).toBe(
      code.replace("interface A { a: string }", "type A = { a: string };"),
    );
  });
});
