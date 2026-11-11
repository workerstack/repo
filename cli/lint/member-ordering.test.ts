import { describe, expect, it } from "vitest";

import { reportsOf } from "../../dev/rule-harness.ts";
import { memberOrdering } from "./member-ordering.ts";

const ORDER = "order static fields, instance fields, constructor, public methods, non-public methods";

/** The message for `member` placed after a member of the later group `later`, as people read it in `repo lint`. */
function late(member: string, later: string): string {
  return `${member} comes after ${later}; ${ORDER}`;
}

function messagesOf(code: string): string[] {
  return reportsOf(memberOrdering, { "src/a.ts": code }).map((report) => report.message);
}

const FAILS: [string, string[]][] = [
  ["export class A {\n  run(): void {}\n  constructor() {}\n}", [late("the constructor", "a public method")]],
  ["export class A {\n  constructor() {}\n  count = 1;\n}", [late("the instance field `count`", "the constructor")]],
  ["export class A {\n  count = 1;\n  static limit = 2;\n}", [late("the static field `limit`", "an instance field")]],
  [
    "export class A {\n  #load(): void {}\n  run(): void {}\n}",
    [late("the public method `run`", "a non-public method")],
  ],
  [
    "export class A {\n  protected load(): void {}\n  get size(): number {\n    return 1;\n  }\n}",
    [late("the public method `size`", "a non-public method")],
  ],
  [
    "export class A {\n  private load(): void {}\n  static create(): A {\n    return new A();\n  }\n  count = 1;\n}",
    [
      late("the public method `create`", "a non-public method"),
      late("the instance field `count`", "a non-public method"),
    ],
  ],
  ["export class A {\n  run(): void {}\n  'my-key' = 1;\n}", [late("the instance field `my-key`", "a public method")]],
  ["export class A {\n  run(): void {}\n  2 = 1;\n}", [late("the instance field `2`", "a public method")]],
  ["export class A {\n  run(): void {}\n  [KEY] = 1;\n}", [late("the instance field", "a public method")]],
  [
    "export class A {\n  #load(): void {}\n  #count = 1;\n}",
    [late("the instance field `#count`", "a non-public method")],
  ],
];

const FULL_ORDER = [
  "export abstract class A {",
  "  [key: string]: unknown;",
  "  static {",
  "    A.ready = true;",
  "  }",
  "  static ready = false;",
  "  static #seen = 0;",
  "  count = 1;",
  "  accessor size = 2;",
  "  #secret = 3;",
  "  abstract kind: string;",
  "  constructor(private readonly name: string, public other = 1) {}",
  "  run(a: string): void;",
  "  run(a: number): void;",
  "  run(a: unknown): void {}",
  "  get value(): number {",
  "    return 1;",
  "  }",
  "  set value(next: number) {}",
  "  static create(): void {}",
  "  abstract make(): void;",
  "  public named(): void {}",
  "  protected guard(): void {}",
  "  private load(): void {}",
  "  #hidden(): void {}",
  "  protected static helper(): void {}",
  "  protected abstract build(): void;",
  "}",
].join("\n");

describe("member-ordering fails", () => {
  it.each(FAILS)("fails %j", (code, messages) => {
    expect(messagesOf(code)).toStrictEqual(messages);
  });
});

describe("member-ordering passes", () => {
  it("passes the full order with an index signature and a static block first", () => {
    expect(messagesOf(FULL_ORDER)).toStrictEqual([]);
  });

  it("passes a class expression in order and a class with no members", () => {
    expect(messagesOf("export const A = class {\n  a = 1;\n  run(): void {}\n};\nexport class B {}")).toStrictEqual([]);
  });
});
