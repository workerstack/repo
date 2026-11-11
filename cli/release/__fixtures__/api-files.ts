const lines = (...text: string[]): string => `${text.join("\n")}\n`;

/** The entry's declarations at the old version. */
export const OLD_INDEX = lines(
  'import type { Dep } from "dep";',
  'import type { DepB } from "depb";',
  "export declare const removedConst: number;",
  "export declare function widenParam(x: string): void;",
  "export declare function widenReturn(): string;",
  "export declare function narrowParam(x: string | number): void;",
  "export declare function sameFn(x: string): string;",
  "export declare function genericFn<T>(x: T): T;",
  "export interface Methods { m(x: string | number): void }",
  "export interface Widens { m(x: string): void }",
  "export interface Shape { a: string }",
  "export interface Opt { a: string }",
  "export interface Fields { a: string; b: string }",
  'export type Loses = "a" | "b";',
  'export type U = "a" | "b";',
  'export declare const PACKS: readonly ["a", "b"];',
  'export declare const ONE: readonly ["a"];',
  "export declare const MIXED: readonly [string, number];",
  "export declare class Priv { private x; m(): void }",
  "export declare class Hash { #private; m(): void }",
  "export declare class Prot { protected x: number }",
  "export declare class Shrunk { a(): void; b(): void }",
  "export declare function makeP(): Priv;",
  "export declare const maybeP: Priv | undefined;",
  "export declare enum E { A, B }",
  "export declare const refE: typeof E;",
  "export declare enum EC { A }",
  "export declare enum ED { A, B }",
  "export declare const sym: unique symbol;",
  "export interface Box<T> { v: T }",
  "export interface Box2<T> { v: T }",
  "declare const aliased: number;",
  "export { aliased };",
  "export declare class LosesValue { a: number }",
  "export interface GainsValue { a: number }",
  "export declare const useDep: Dep;",
  "export declare const useDepB: DepB;",
);

/** The entry's declarations at the new version, one name changed per line of the old. */
export const NEW_INDEX = lines(
  'import type { Dep } from "dep";',
  'import type { DepB } from "depb";',
  "export declare const newConst: number;",
  "export declare function widenParam(x: string | number): void;",
  "export declare function widenReturn(): string | number;",
  "export declare function narrowParam(x: string): void;",
  "export declare function sameFn(x: string): string;",
  "export declare function genericFn<T>(x: T): T;",
  "export interface Methods { m(x: string): void }",
  "export interface Widens { m(x: string | number): void }",
  "export interface Shape { a: string; b: string }",
  "export interface Opt { a: string; b?: string }",
  "export interface Fields { a: string }",
  'export type Loses = "a";',
  'export type U = "a" | "b" | "c";',
  'export declare const PACKS: readonly ["a", "b", "c"];',
  'export declare const ONE: readonly ["a"];',
  "export declare const MIXED: readonly [string, number];",
  "export declare class Priv { private x; m(): void }",
  "export declare class Hash { #private; m(): void }",
  "export declare class Prot { protected x: number }",
  "export declare class Shrunk { a(): void }",
  "export declare function makeP(): Priv;",
  "export declare const maybeP: Priv | undefined;",
  "export declare enum E { A, B }",
  "export declare const refE: typeof E;",
  "export declare enum EC { A, B }",
  "export declare enum ED { A }",
  "export declare const sym: unique symbol;",
  "export interface Box<T> { v: T }",
  "export interface Box2<T> { v: T; w: T }",
  "declare const aliased: number;",
  "export { aliased };",
  "export interface LosesValue { a: number }",
  "export declare class GainsValue { a: number }",
  "export declare const useDep: Dep;",
  "export declare const useDepB: DepB;",
);

/** A dependency whose `Dep` holds a nominal class, so two copies are never assignable. */
export const DEP = lines("export declare class Cls { private z: number }", "export interface Dep { c: Cls; o?: number }");

/** The same, named `DepB`, and then changed one release on. */
export const DEP_B = lines("export declare class Cls { private z: number }", "export interface DepB { c: Cls }");
export const DEP_B_CHANGED = lines(
  "export declare class Cls { private z: number }",
  "export interface DepB { c: Cls; extra: string }",
);

/** A class whose private member is declared as a parameter property, as a `.ts` source does. */
export const OLD_SRC = lines("export declare class Param { private x: number; constructor(x: number) }");
export const NEW_SRC = lines("export class Param { constructor(private x: number) {} }");

const code = (types: string, runtime = types.replace(/\.d\.ts$/, ".js")) => ({ types, default: runtime });

/** The `exports` of the old version: three code subpaths, a JSON one and a wildcard to non-code files. */
export const OLD_EXPORTS: Record<string, unknown> = {
  ".": code("./index.d.ts"),
  "./gone": code("./gone.d.ts"),
  "./src": code("./src.d.ts"),
  "./data": "./data.json",
  "./extra": "./extra.json",
  "./agents/*": "./agents/*",
};

/** The `exports` of the new version: `./gone` is replaced by `./fresh`. */
export const NEW_EXPORTS: Record<string, unknown> = {
  ".": code("./index.d.ts"),
  "./fresh": code("./fresh.d.ts"),
  "./src": code("./src.ts", "./src.ts"),
  "./data": "./data.json",
};

export const GONE_DECLARATIONS = "export declare const x: number;\n";
