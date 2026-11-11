import { describe, expect, it } from "vitest";

import { reportsOf } from "../../dev/rule-harness.ts";
import { noModuleSideEffects } from "./no-module-side-effects.ts";

const MESSAGE = "module scope runs no code; move this into a function, or mark a pure call /* @__PURE__ */";
function messagesOf(code: string) {
  return reportsOf(noModuleSideEffects, { "a.ts": code }).map((report) => report.message);
}

describe("no-module-side-effects passes", () => {
  it.each([
    '"use strict";\nexport const a = 1;',
    'import { b } from "./b.ts";\nexport { b };\nexport * from "./c.ts";',
    "export function run() { start(); return new Map(); }",
    "export const run = () => start();",
    "export const make = function () { return new Map(); };",
    "type A = string;\ninterface B { a: A }\nenum C { D }\ndeclare function e(): void;\nnamespace F {}",
    "const sum = 1 + 2, list = [1, 2], text = `a${list}`;",
    "export const store = /* @__PURE__ */ createStore();",
    "export const store = /* #__PURE__ */ new Store();",
    "export default function main() { start(); }",
    "export class Box { size = measure(); method() { return run(); } }",
    "export const Box = class { size = measure(); };",
    "class Empty { static {} static count = 0; static label: string; }",
    "export = {};",
  ])("%j", (code) => {
    expect(messagesOf(code)).toStrictEqual([]);
  });
});

describe("no-module-side-effects fails", () => {
  it.each([
    "start();",
    "export const a = 1;\nconst store = createStore();",
    "const store = new Store();",
    "const data = await load();",
    "let n = 0;\nn = 1;",
    "let n = 0;\nn++;",
    "const html = tag`a`;",
    "export const list = [1, start()];",
    "export const store = /* @__PURE__ */ createStore(start());",
    "export default start();",
    "if (import.meta.main) main();",
    "for (const name of names) {}",
    "export class Box { static size = measure(); }",
    "export class Box { static { start(); } }",
    "@sealed export class Box {}",
    "export class Box { @logged method() {} }",
    "export class Box { @tracked size = 0; }",
    "export class Box extends mixin(Base) {}",
    "export class Box { [key()]() {} }",
    "export class Box { [key()] = 1; }",
    "export const Box = class { static size = measure(); };",
    "export default class { static size = measure(); }",
  ])("%j once", (code) => {
    expect(messagesOf(code)).toStrictEqual([MESSAGE]);
  });
});
