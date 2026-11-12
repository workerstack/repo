import { describe, expect, it } from "vitest";

import { reportsOf } from "../../dev/rule-harness.ts";
import { classFile } from "./class-file.ts";

function move(what: string) {
  return `a class file holds one class, its imports and its export; move ${what} to its own file`;
}

function messagesOf(code: string) {
  return reportsOf(classFile, { "src/store.ts": code }).map((report) => report.message);
}

describe("class-file passes", () => {
  it.each([
    'import { db } from "./db.ts";\nimport type { Row } from "./row.ts";\nexport class Store {\n  rows: Row[] = [];\n}',
    "class Store {}\nexport { Store };",
    "class Store {}\nexport default Store;",
    "export default class Store {}",
    "export default class {}",
    "export function parseRow(): void {}\nexport const ROWS = 1;\ntype Row = { id: string };",
  ])("one class with its imports and export, or a file with no class: %j", (code) => {
    expect(messagesOf(code)).toStrictEqual([]);
  });
});

describe("class-file fails", () => {
  it.each([
    ["export class Store {}\nexport function parseRow(): void {}", [move('"parseRow"')]],
    ["export class Store {}\nclass Cache {}", [move('"Cache"')]],
    ["export class Store {}\nexport default class Cache {}", [move('"Cache"')]],
    ["const LIMIT = 3;\nexport class Store {}", [move('"LIMIT"')]],
    ["export class Store {}\nexport const { a, b } = { a: 1, b: 2 };", [move('"a", "b"')]],
    ["export class Store {}\ntype Row = { id: string };\ninterface Col {}", [move('"Row"'), move('"Col"')]],
    ['export class Store {}\nexport { other } from "./other.ts";', [move("this")]],
    ["class Store {}\nexport { Store, Store as Alias };", [move("this")]],
    ["class Store {}\nexport default 1;", [move("this")]],
    ["export class Store {}\nnew Store();", [move("this")]],
  ])("%j", (code, messages) => {
    expect(messagesOf(code)).toStrictEqual(messages);
  });
});
