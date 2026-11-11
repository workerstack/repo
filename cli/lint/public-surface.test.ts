/**
 * The walk behind the public-surface rules, on real packages on disk because it crosses files: each re-export form and
 * each type position reaches the declaring file with the entry that reaches it.
 */
import path from "node:path";

import { afterEach, expect, it } from "vitest";

import { removePlanted } from "../fixtures/planted-repo.ts";
import { namesIn, unknownIn, withEntries } from "../fixtures/surface-package.ts";
import { publicSurface } from "./public-surface.ts";

afterEach(removePlanted);

const ENTRY = { ".": "./src/index.ts" };
const INDEX = "src/index.ts";

const RE_EXPORTS = [
  'export { a, b as renamed } from "./named.ts";',
  'export * from "./star.ts";',
  'export * as space from "./space.ts";',
  'import { imported } from "./imported.ts";',
  "export { imported };",
  'export { default as fallback } from "./fallback.ts";',
  'export { x as "quoted" } from "./quoted.ts";',
  'import chosenDefault from "./picked.ts";',
  "export { chosenDefault };",
  "export function own(): void {}",
  "export default function chosen(): void {}",
].join("\n");

it("follows every re-export form from an entry to the file that declares the name", () => {
  const root = withEntries(ENTRY, {
    [INDEX]: RE_EXPORTS,
    "src/deep.ts": "export type Deep = string;\n",
    "src/fallback.ts": "export default function picked(): void {}\n",
    "src/imported.ts": "export const imported = 1;\n",
    "src/named.ts": "export const a = 1;\nexport const b = 2;\nexport const hidden = 3;\n",
    "src/picked.ts": "export default class Picked {}\n",
    "src/quoted.ts": "export const x = 1;\n",
    "src/space.ts": "export const inSpace = 1;\n",
    "src/star.ts": 'export const s = 1;\nexport * from "./deep.ts";\nexport default function skipped(): void {}\n',
  });
  expect(namesIn(root)).toStrictEqual({
    [INDEX]: ["chosen", "own"],
    "src/deep.ts": ["Deep"],
    "src/fallback.ts": ["picked"],
    "src/imported.ts": ["imported"],
    "src/named.ts": ["a", "b"],
    "src/picked.ts": ["Picked"],
    "src/quoted.ts": ["x"],
    "src/space.ts": ["inSpace"],
    "src/star.ts": ["s"],
  });
  expect(unknownIn(root)).toStrictEqual([]);
});

it("names each reached declaration with the entry that reaches it first", () => {
  const root = withEntries(
    { ".": "./src/index.ts", "./cors": "./src/cors.ts" },
    {
      [INDEX]: 'export { shared } from "./cors.ts";\n',
      "src/cors.ts": "export const shared = 1;\nexport const only = 2;\n",
    },
  );
  const surface = publicSurface(root);
  const names = surface.names.get(path.join(root, "src/cors.ts"));
  expect(names?.get("shared")).toBe(".");
  expect(names?.get("only")).toBe("./cors");
});

it("reaches a default export of an identifier and an anonymous default function", () => {
  const root = withEntries(
    { ".": "./src/index.ts", "./anon": "./src/anon.ts" },
    { [INDEX]: "const value = 1;\nexport default value;\n", "src/anon.ts": "export default function (): void {}\n" },
  );
  expect(namesIn(root)).toStrictEqual({ [INDEX]: ["value"], "src/anon.ts": ["default"] });
});

it("reaches a namespace import that is exported", () => {
  const root = withEntries(ENTRY, {
    [INDEX]: 'import * as ns from "./ns.ts";\nexport { ns };\n',
    "src/ns.ts": "export const inside = 1;\n",
  });
  expect(namesIn(root)).toStrictEqual({ "src/ns.ts": ["inside"] });
});

it("does not look into a package outside the walk", () => {
  const root = withEntries(ENTRY, {
    [INDEX]: 'import type { Z } from "zod";\nexport type A = Z;\nexport * from "zod";\nexport { y } from "zod";\n',
  });
  expect(unknownIn(root)).toStrictEqual([]);
  expect(namesIn(root)).toStrictEqual({ [INDEX]: ["A"] });
});

const POSITIONS = [
  'import type { Param, Returned, Base, Shape, Face, Contract, Pick } from "./types.ts";',
  "type Local = { a: string };",
  "const thing = 1;",
  "export function f(p: Param): Returned { return p as never; }",
  "export class C extends Base implements Contract {}",
  "export interface I extends Face {}",
  "export type K = Shape | Local | typeof thing | Pick;",
  'export type M = import("./types.ts").Imported;',
  'export type W = import("./wide.ts");',
  "export type T = `a${string}`;",
  "export type G = Promise<string>;",
].join("\n");

const TYPES = [
  "export type Param = string;",
  "export type Returned = number;",
  "export class Base {}",
  "export type Shape = boolean;",
  "export interface Face {}",
  "export interface Contract {}",
  "export type Pick = string;",
  "export type Imported = string;",
  "export type Unreached = string;",
].join("\n");

it("reaches an unexported type through each type position", () => {
  const root = withEntries(ENTRY, {
    [INDEX]: POSITIONS,
    "src/types.ts": TYPES,
    "src/wide.ts": "export const wide = 1;\n",
  });
  expect(namesIn(root)).toStrictEqual({
    [INDEX]: ["C", "G", "I", "K", "Local", "M", "T", "W", "f", "thing"],
    "src/types.ts": ["Base", "Contract", "Face", "Imported", "Param", "Pick", "Returned", "Shape"],
    "src/wide.ts": ["wide"],
  });
});

it("reaches a member of a namespace import by its qualified name, and a base class by a member expression", () => {
  const root = withEntries(ENTRY, {
    [INDEX]: [
      'import type * as NS from "./types.ts";',
      'import * as values from "./values.ts";',
      "export type U = NS.Picked.Deeper;",
      "export class C extends values.Base {}",
      "export class D extends values.make().Other {}",
    ].join("\n"),
    "src/types.ts": "export type Picked = string;\nexport type Other = string;\n",
    "src/values.ts": "export class Base {}\nexport function make(): never { throw new Error(); }\n",
  });
  expect(namesIn(root)).toStrictEqual({
    [INDEX]: ["C", "D", "U"],
    "src/types.ts": ["Picked"],
    "src/values.ts": ["Base"],
  });
});

const SHOWN = [
  'import type { Cast, Called, Typed, Param, Hidden, Arrow } from "./types.ts";',
  "export const cast = {} as Cast;",
  "export const called = make<Called>();",
  "export const arrow = (a: Arrow): void => { void a; };",
  "export class C { typed: Typed = make<Called>(); private secret: Hidden = 1 as never; }",
  "export class D { protected also: Hidden = 1 as never; #own: Hidden = 1 as never; }",
  "export function f(a: Param = {} as Hidden): void { const x: Hidden = a as never; void x; }",
  "declare function make<T>(): T;",
].join("\n");

it("reaches a type behind a typed initializer and not behind an untyped one, a private member or a body", () => {
  const names = ["Cast", "Called", "Typed", "Param", "Hidden", "Arrow"];
  const root = withEntries(ENTRY, {
    [INDEX]: SHOWN,
    "src/types.ts": names.map((name) => `export type ${name} = string;`).join("\n"),
  });
  expect(namesIn(root)).toStrictEqual({
    [INDEX]: ["C", "D", "arrow", "called", "cast", "f"],
    "src/types.ts": ["Arrow", "Cast", "Param", "Typed"],
  });
});

it("does not take a type parameter for the declaration it shadows", () => {
  const root = withEntries(ENTRY, {
    [INDEX]: "type T = string;\nexport type Box<T> = { value: T };\nexport type Unused = number;\n",
  });
  expect(namesIn(root)).toStrictEqual({ [INDEX]: ["Box", "Unused"] });
});

it("reaches an imported type when the type parameter shadows another name", () => {
  const root = withEntries(ENTRY, {
    [INDEX]: 'import type { Item } from "./item.ts";\nexport type Box<T> = { value: T; item: Item };\n',
    "src/item.ts": "export type Item = string;\n",
  });
  expect(namesIn(root)).toStrictEqual({ [INDEX]: ["Box"], "src/item.ts": ["Item"] });
});
