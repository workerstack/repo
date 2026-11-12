import { describe, expect, it } from "vitest";

import { fixedOf, reportsOf } from "../../dev/rule-harness.ts";
import { requireReadableSpacing } from "./require-readable-spacing.ts";

const MESSAGE = "Expected blank line before this statement.";

/** The messages the rule reports over `code` as one TS file. */
function messagesOf(code: string) {
  return reportsOf(requireReadableSpacing, { "a.ts": code }).map((report) => report.message);
}

const VALID = [
  "import { a } from 'a';\nimport { b } from 'b';\n\nexport const c = a + b;",
  "function f() {\nconst a = 1;\nconst b = 2;\n\nreturn a + b;\n}",
  "function f() { return 1; }",
  "function f(a: string): string;\nfunction f(a: number): number;\nfunction f(a: string | number) { return a; }",
  "export function f(a: string): string;\nexport function f(a: number): number;\n" +
    "export function f(a: string | number) { return a; }",
  "const f = Effect.gen(function* () {\nconst a = yield* A;\nconst b = yield* B;\n\nreturn a + b;\n});",
  "export type A = string;\n\n/** B documentation. */\nexport type B = number;",
  "function f() { if (ok) { go(); } else { stop(); } }",
  "function f() {\n// return docs\nreturn 1;\n}",
  "const a = 1;\n\n\nconst b = 2;",
  "switch (x) { case 1: case 2: go(); break; default: stop(); }",
  "const a = 1;\nconst b = 2;",
  "export const a = 1;\nexport const b = 2;",
  "const a = 1;\nlet b = 2;\nvar c = 3;",
  "function f() {\nconst a = 1;\nusing b = open();\n\nreturn a;\n}",
  "const a = 1;\nconst b = 2;\n\nconst c = 3;",
  "const a = 1; // trailing\nconst b = 2;",
  "/** Heads a group. */\nconst a = 1;\nconst b = 2;",
  "import { a } from 'a';\n\nconst b = a;\nexport const c = b;",
  // a namespace body is not module scope: two plain statements there stay together
  "namespace N {\nconst a = 1;\nfoo(a);\n}",
  // a switch case that ends in a statement, not a block, needs no blank line after it
  "switch (x) {\ncase 1:\ngo();\nbreak;\ncase 2:\nstop();\n}",
  // a do-while over a bare statement ends in its condition, not a block
  "function f() {\ndo go(); while (ok);\nstop();\n}",
  // an expression statement that calls nothing is no IIFE
  "function f() {\nx = 1;\nfoo();\n}",
  // `export =` is no statement esquery's `:statement` matches: the walk passes over it
  "const a = 1;\nexport = a;",
];

/** Source, the source after `--fix`, and how many blank lines the rule asks for. */
const INVALID: readonly (readonly [string, string, number])[] = [
  ["const a = 1;\n/** B docs. */\nconst b = 2;", "const a = 1;\n\n/** B docs. */\nconst b = 2;", 1],
  ["const a = 1;\n// b\nconst b = 2;", "const a = 1;\n\n// b\nconst b = 2;", 1],
  ["const a = 1;\nconst b = {\n};\nconst c = 3;", "const a = 1;\n\nconst b = {\n};\n\nconst c = 3;", 2],
  ["const a = 1;\nfoo(a);", "const a = 1;\n\nfoo(a);", 1],
  [
    "export const a = 1;\n/** B docs. */\nexport type B = number;",
    "export const a = 1;\n\n/** B docs. */\nexport type B = number;",
    1,
  ],
  ["const a = 1; // trailing\n// leading\nconst b = 2;", "const a = 1; // trailing\n\n// leading\nconst b = 2;", 1],
  ["const a = 1; foo(a);", "const a = 1;\n\n foo(a);", 1],
  ["import { a } from 'a';\nconst b = a;", "import { a } from 'a';\n\nconst b = a;", 1],
  ["function f() {\nconst a = 1;\nreturn a;\n}", "function f() {\nconst a = 1;\n\nreturn a;\n}", 1],
  ["function f() {\nconst a = 1;\nif (a) go();\n}", "function f() {\nconst a = 1;\n\nif (a) go();\n}", 1],
  ["function f() {\nif (ok) { go(); }\nstop();\n}", "function f() {\nif (ok) { go(); }\n\nstop();\n}", 1],
  [
    "const f = Effect.gen(function* () {\nconst a = yield* A;\nconst b = yield* B;\n" +
      "const dispatch = Effect.fn('dispatch')(function* () {\nyield* a;\n});\nreturn dispatch;\n});",
    "const f = Effect.gen(function* () {\nconst a = yield* A;\nconst b = yield* B;\n\n" +
      "const dispatch = Effect.fn('dispatch')(function* () {\nyield* a;\n});\n\nreturn dispatch;\n});",
    2,
  ],
  ["export interface A {}\nexport class B {}", "export interface A {}\n\nexport class B {}", 1],
  ["const a = 1\n;[1].forEach(f)", "const a = 1\n\n;[1].forEach(f)", 1],
  ["function f() {\nfoo();\nwhile (ok) go();\n}", "function f() {\nfoo();\n\nwhile (ok) go();\n}", 1],
  // a labeled statement is tested by the statement it labels
  [
    "function f() {\nfoo();\nloop: for (;;) break loop;\n}",
    "function f() {\nfoo();\n\nloop: for (;;) break loop;\n}",
    1,
  ],
  // a switch case that ends in a block is block-like
  [
    "switch (x) {\ncase 1: {\ngo();\n}\ncase 2:\nstop();\n}",
    "switch (x) {\ncase 1: {\ngo();\n}\n\ncase 2:\nstop();\n}",
    1,
  ],
  ["namespace N {\nconst a = 1;\nfunction f() {}\n}", "namespace N {\nconst a = 1;\n\nfunction f() {}\n}", 1],
  [
    "class A {\nstatic {\nconst a = 1;\nif (a) go();\n}\n}",
    "class A {\nstatic {\nconst a = 1;\n\nif (a) go();\n}\n}",
    1,
  ],
  // an IIFE is block-like, with or without a braced body
  [
    "function f() {\n(function () {\ngo();\n})();\nstop();\n}",
    "function f() {\n(function () {\ngo();\n})();\n\nstop();\n}",
    1,
  ],
  ["function f() {\n(() => go())();\nstop();\n}", "function f() {\n(() => go())();\n\nstop();\n}", 1],
  // an IIFE called through an optional chain, behind a unary operator, or as a sequence's last expression
  ["function f() {\n(() => go())?.();\nstop();\n}", "function f() {\n(() => go())?.();\n\nstop();\n}", 1],
  [
    "function f() {\n!function () { go(); }();\nstop();\n}",
    "function f() {\n!function () { go(); }();\n\nstop();\n}",
    1,
  ],
  ["function f() {\n(0, () => go())();\nstop();\n}", "function f() {\n(0, () => go())();\n\nstop();\n}", 1],
  // a do-while over a block is block-like
  ["function f() {\ndo { go(); } while (ok);\nstop();\n}", "function f() {\ndo { go(); } while (ok);\n\nstop();\n}", 1],
];

describe("require-readable-spacing", () => {
  it.each(VALID)("passes %j", (code) => {
    expect(messagesOf(code)).toStrictEqual([]);
  });

  it.each(INVALID)("asks for blank lines in %j and inserts them", (code, output, count) => {
    expect(messagesOf(code)).toStrictEqual(Array.from({ length: count }, () => MESSAGE));
    expect(fixedOf(requireReadableSpacing, code)).toBe(output);
  });
});
