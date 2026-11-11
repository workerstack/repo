import { describe, expect, it } from "vitest";

import { reportsOf } from "../../dev/rule-harness.ts";
import { namingConvention } from "./naming-convention.ts";

/** The messages, as people read them in `repo lint`. */
function literal(name: string, fixed: string): string {
  return `\`${name}\` is a module-level literal const; name it ${fixed}`;
}
function flag(name: string, fixed: string): string {
  return `\`${name}\` holds a boolean; name it with is/has/can/should/was, like ${fixed}`;
}
function camel(name: string, kind: string, fixed: string): string {
  return `\`${name}\` is ${kind}; name it in camelCase: ${fixed}`;
}
function pascal(kind: string, name: string, fixed: string): string {
  return `${kind} \`${name}\` is not PascalCase; name it ${fixed}`;
}

function messagesOf(code: string, file = "src/a.ts"): string[] {
  return reportsOf(namingConvention, { [file]: code }).map((report) => report.message);
}

const FAILS: [string, string][] = [
  ['const tail = "x";\nexport const a = tail;', literal("tail", "TAIL")],
  ["const magicRegex = /a+/u;\nexport const a = magicRegex;", literal("magicRegex", "MAGIC_REGEX")],
  ["const limit = -1;\nexport const a = limit;", literal("limit", "LIMIT")],
  ["export function f(): boolean {\n  const found: boolean = g();\n  return found;\n}", flag("found", "isFound")],
  ["export function f(): boolean {\n  let found = true;\n  return found;\n}", flag("found", "isFound")],
  ["export function f(x: number): boolean {\n  const empty = !x;\n  return empty;\n}", flag("empty", "isEmpty")],
  ["export function f(x: number): boolean {\n  const same = x === 1;\n  return same;\n}", flag("same", "isSame")],
  ["let ready = false;\nexport function f(): boolean {\n  return ready;\n}", flag("ready", "isReady")],
  ["export function f(x: number): boolean {\n  const island = x > 1;\n  return island;\n}", flag("island", "isIsland")],
  ["export function f(x: number): boolean {\n  const hash = x > 1;\n  return hash;\n}", flag("hash", "isHash")],
  ["export function f(x: number): boolean {\n  const canvas = x > 1;\n  return canvas;\n}", flag("canvas", "isCanvas")],
  ["export function f(x: number): boolean {\n  const wasm = x > 1;\n  return wasm;\n}", flag("wasm", "isWasm")],
  [
    "export function f(): number {\n  const PROGRAM_TIMEOUT = g();\n  return PROGRAM_TIMEOUT;\n}",
    camel("PROGRAM_TIMEOUT", "a local", "programTimeout"),
  ],
  [
    "export function f(tool_name: string): string {\n  return tool_name;\n}",
    camel("tool_name", "a parameter", "toolName"),
  ],
  ["function MakeThing(): void {}\nexport const a = MakeThing;", camel("MakeThing", "a function", "makeThing")],
  ["const MakeThing = (): number => 1;\nexport const a = MakeThing;", camel("MakeThing", "a function", "makeThing")],
  ["const my_map = { a: 1 };\nexport const a = my_map;", camel("my_map", "a module-level const", "myMap")],
  ["export const Some_thing = g();", camel("Some_thing", "an export", "someThing")],
  ["export type config_shape = { a: string };", pascal("type", "config_shape", "ConfigShape")],
  ["export class my_store {}", pascal("class", "my_store", "MyStore")],
  ["export interface user_row {\n  id: string;\n}", pascal("interface", "user_row", "UserRow")],
  ["export enum color {\n  Red,\n}", pascal("enum", "color", "Color")],
  ["export enum Color {\n  dark_red,\n}", pascal("enum member", "dark_red", "DarkRed")],
  ["export function f(): void {\n  const { a: my_a } = g();\n  h(my_a);\n}", camel("my_a", "a local", "myA")],
  ["export function f(): void {\n  const [, my_b] = g();\n  h(my_b);\n}", camel("my_b", "a local", "myB")],
  ["const my_map = { a: 1 };\nexport { my_map };", camel("my_map", "an export", "myMap")],
  ["const tail = `x`;\nexport const a = tail;", literal("tail", "TAIL")],
  ['const tail = "x" as const;\nexport const a = tail;', literal("tail", "TAIL")],
  ['const $ = "x";\nexport const a = $;', literal("$", "$")],
  ["export class $ {}", pascal("class", "$", "$")],
  [
    "export function f(): boolean | undefined {\n  const found: boolean | undefined = g();\n  return found;\n}",
    flag("found", "isFound"),
  ],
  ["let my_x = g();\nexport const a = my_x;", camel("my_x", "a module-level variable", "myX")],
  ["export function Make_thing(): void {}", camel("Make_thing", "an export", "makeThing")],
  ["export function f(...my_args: string[]): void {}", camel("my_args", "a parameter", "myArgs")],
  ["export function f(my_a = 1): number {\n  return my_a;\n}", camel("my_a", "a parameter", "myA")],
];

const PASSES = [
  'export const prerender = "auto";',
  "export const prerender = true;",
  "export function GET(): void {}",
  "export const MAX_RETRIES = 3;",
  "const DEFAULTS = { a: 1 };\nexport const a = DEFAULTS;",
  "const defaults = { a: 1 };\nexport const a = defaults;",
  "const DEBUG = false;\nexport const a = DEBUG;",
  "const WORD = /a+/u;\nexport const a = WORD;",
  "const isWindows = process.platform === 'win32';\nexport const a = isWindows;",
  [
    "export function f(x: number): boolean {",
    "  const isReady = x > 1;",
    "  const hasX = !x;",
    "  const canX: boolean = g();",
    "  const shouldX = true;",
    "  const wasX = x === 2;",
    "  return isReady && hasX && canX && shouldX && wasX;",
    "}",
  ].join("\n"),
  "export function run(force: boolean): boolean {\n  return force;\n}",
  "export function run(_unused: string, _Other_one: number): void {}",
  "export function f(): object {\n  const { secret: _drop, ...rest } = g();\n  return rest;\n}",
  [
    'import { Some_thing, default as Other_thing } from "x";',
    'import * as Lib_name from "y";',
    "export const a = [Some_thing, Other_thing, Lib_name];",
  ].join("\n"),
  "export function f(): void {\n  const { Some_key, other_key = 1 } = g();\n  h(Some_key, other_key);\n}",
  "export const table = { Some_key: 1, other_key: 2, 'a-b': 3 };",
  "export class Store {\n  Some_field = 1;\n  other_method(): void {}\n}",
  "export function f<T_item>(x: T_item): T_item {\n  return x;\n}",
  "export function f(): boolean {\n  const found = g();\n  return found;\n}",
  "export function f(): number {\n  for (const item of g()) h(item);\n  return 1;\n}",
  "export enum Color {\n  DarkRed,\n  'light-red',\n}",
  "export function f(): number {\n  const count: number = g();\n  return count;\n}",
  "export function f(): unknown {\n  const found: boolean | string = g();\n  return found;\n}",
  "export function f(): unknown {\n  const found: string | undefined = g();\n  return found;\n}",
  "declare const Some_thing: string;\ndeclare class my_store {}",
  "global {\n  var Some_thing: string;\n  function Make_thing(): void {}\n}",
  "export class Store {\n  constructor(private my_x: string) {}\n}",
  "export default function (): void {}",
];

const JSX_PASSES = [
  "export function Button(): unknown {\n  return <button />;\n}",
  "function Card(): unknown {\n  return <>card</>;\n}\nexport const a = Card;",
  "const Panel = (): unknown => <div />;\nexport const a = Panel;",
  "export const Row = function (): unknown {\n  return <tr />;\n};",
  "export const Panel = (on) => on ? null : <div />;",
  "export const Panel = (on) => on && <div />;",
];

describe("naming-convention fails", () => {
  it.each(FAILS)("fails %j", (code, message) => {
    expect(messagesOf(code)).toStrictEqual([message]);
  });

  it("fails a PascalCase function that returns no JSX in a .tsx file", () => {
    expect(messagesOf("function Card(): number {\n  return 1;\n}\nexport const a = Card;", "src/a.tsx")).toStrictEqual([
      camel("Card", "a function", "card"),
    ]);
  });

  it("fails a PascalCase function whose only JSX is in a nested function in a .tsx file", () => {
    const code = "export function Card(): unknown {\n  const icon = () => <i />;\n  return icon;\n}";
    expect(messagesOf(code, "src/a.tsx")).toStrictEqual([camel("Card", "an export", "card")]);
  });

  it("fails a misnamed const with no value in a .d.ts file", () => {
    expect(messagesOf("const my_x: string;", "src/a.d.ts")).toStrictEqual([
      camel("my_x", "a module-level const", "myX"),
    ]);
  });

  it("reports a misnamed boolean once, with the prefixed camelCase name", () => {
    const code = "export function f(x: number): boolean {\n  const FOUND = x === 1;\n  return FOUND;\n}";
    expect(messagesOf(code)).toStrictEqual([flag("FOUND", "isFound")]);
  });
});

describe("naming-convention passes", () => {
  it.each(PASSES)("passes %j", (code) => {
    expect(messagesOf(code)).toStrictEqual([]);
  });

  it.each(JSX_PASSES)("passes the JSX component %j in .tsx and .jsx", (code) => {
    expect([messagesOf(code, "src/a.tsx"), messagesOf(code.replaceAll(": unknown", ""), "src/a.jsx")]).toStrictEqual([
      [],
      [],
    ]);
  });
});
