import { expect, it } from "vitest";

import { reportsOf } from "../../dev/rule-harness.ts";
import { publicJsdoc } from "./public-jsdoc.ts";

const MISSING = "has no JSDoc: add a /** */ block that says what a caller needs and the type does not";
const INFERRED = "its type is inferred, so its shape goes unchecked: write the type out";
const DOC = "/** Describes what callers get here. */\n";

/** What the rule reports for `code` as the "." entry of a package. */
function messagesOf(code: string): string[] {
  const files = {
    "package.json": JSON.stringify({ exports: { ".": "./src/index.ts" }, name: "p" }),
    "src/index.ts": code,
  };

  return reportsOf(publicJsdoc, files).map((report) => report.message);
}

function about(label: string, text: string) {
  return `\`${label}\` is public through "." and ${text}`;
}

function documented(head: string, body: string[]): string {
  return `${DOC}${head} {\n${body.join("\n")}\n}`;
}

type Case = { name: string; code: string; messages: string[] };

const MEMBERS: Case[] = [
  {
    code: documented("export class C", ["m(): void {}", "p: string = '';"]),
    messages: [about("C.m", MISSING), about("C.p", MISSING)],
    name: "a class method and property without docs",
  },
  {
    code: documented("export interface I", ["a: string;", "(): void;", "[key: string]: string;"]),
    messages: [about("I.a", MISSING), about("I.(call)", MISSING), about("I.(index)", MISSING)],
    name: "an interface member, a call signature and an index signature",
  },
  {
    code: `${documented("export interface K", ["new (): K;"])}\n${documented("export enum E", ["A = 1"])}`,
    messages: [about("K.(new)", MISSING), about("E.A", MISSING)],
    name: "a construct signature and an enum member",
  },
  {
    code: `${DOC}export type T = {\n/** Shown. */\na: string;\nb: number };`,
    messages: [about("T.b", MISSING)],
    name: "a type literal member behind an alias",
  },
  {
    code: documented("export class C", [`${DOC}m() { return 1; }`, `${DOC}p = compute();`, `${DOC}q = 1;`]),
    messages: [about("C.m", INFERRED), about("C.p", INFERRED)],
    name: "inferred method and property types",
  },
  {
    code: documented("export class C", [`${DOC}constructor(public a: string) {}`, `${DOC}'quoted': string = '';`]),
    messages: [about("C.a", MISSING)],
    name: "a parameter property and a literal key",
  },
  {
    code: documented("export class C", ["1: string = '';", "2n: string = '';"]),
    messages: [about("C.1", MISSING), about("C.2", MISSING)],
    name: "numeric and bigint member keys",
  },
];

it.each(MEMBERS)("reports $name", ({ code, messages }) => {
  expect(messagesOf(`declare function compute(): number;\n${code}`)).toStrictEqual(messages);
});

const SKIPPED = [
  documented("export class C", ["private a: string = '';", "protected b(): void {}", "#c: string = '';"]),
  documented("export class C", [`${DOC}static s(): void {}`, `${DOC}m(): void {}`]),
  documented("export class C", [`${DOC}static { init(); }`, `${DOC}[Symbol.iterator](): void {}`]),
  documented("export class C", [`${DOC}get a(): string { return ''; }`, "set a(value: string) {}"]),
  documented("export class C", [`${DOC}m(a: string): void;`, `${DOC}m(a: number): void;`, "m(a: unknown): void {}"]),
  `${DOC}export function f(a: string): void;\n${DOC}export function f(a: number): void;\n` +
    "export function f(a: unknown): void {}",
  `${DOC}export type Pick<T> = T extends { a: infer U } ? U : never;`,
];

it.each(SKIPPED)("skips private members, hidden forms and overload implementations: %#", (code) => {
  expect(messagesOf(`declare function init(): void;\n${code}`)).toStrictEqual([]);
});

it("reports a class setter that has no getter beside it", () => {
  const code = documented("export class C", ["set a(value: string) {}"]);
  expect(messagesOf(code)).toStrictEqual([about("C.a", MISSING)]);
});
