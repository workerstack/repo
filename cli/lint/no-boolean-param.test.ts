import { describe, expect, it } from "vitest";

import { reportsOf } from "../../dev/rule-harness.ts";
import { noBooleanParam } from "./no-boolean-param.ts";

const REPEATED = "export function run(force: boolean): void";

const FAILS = [
  `${REPEATED} {}`,
  "export function run(force?: boolean): void {}",
  "export function run(force = false): void {}",
  "export function run(force: boolean = true): void {}",
  "export function run(force: boolean | undefined): void {}",
  "export function run(name: string, force: boolean): void {}",
  "declare function run(force: boolean): void;",
  `${REPEATED};\n${REPEATED} {}`,
  "export class A {\n  run(force: boolean): void {}\n}",
  "export class A {\n  static run(force = true): void {}\n}",
  "export abstract class A {\n  abstract run(force: boolean): void;\n}",
  "export class A {\n  constructor(force: boolean) {}\n}",
  "export class A {\n  constructor(private force: boolean) {}\n}",
  "export class A {\n  constructor(readonly force = false) {}\n}",
  "export class A {\n  run = (force: boolean): void => {};\n}",
  "export class A {\n  static run = function (force = true): void {};\n}",
  "export const run = (force: boolean): void => {};",
  "export const run = function (force: boolean): void {};",
];

const PASSES = [
  "[1].map((flag: boolean) => flag);",
  "export const handlers = { run(force: boolean): void {} };",
  "export const handlers = { run: (force: boolean): void => {} };",
  "export class A {\n  set force(value: boolean) {}\n}",
  "export interface Run {\n  run(force: boolean): void;\n  (force: boolean): void;\n}",
  "export type Run = { run(force: boolean): void; call: (force: boolean) => void };",
  "export function run({ force }: { force: boolean }): void {}",
  "export function run({ force }: { force: boolean } = { force: true }): void {}",
  "export function run(options: { force: boolean }): void {}",
  "export function run(flag: string): void {}",
  "export function run(flag = 'on', count = 1): void {}",
  "export function run(flag: string | number): void {}",
  "export function run(flag: 'a' | 'b'): void {}",
  "export function run(...flags: boolean[]): void {}",
];

function flag(name: string): string {
  return (
    `\`${name}: boolean\` is a positional flag the call cannot name; ` +
    `take an options object ({ ${name} }) or split the function in two`
  );
}

function messagesOf(code: string): string[] {
  return reportsOf(noBooleanParam, { "src/a.ts": code }).map((report) => report.message);
}

describe("no-boolean-param fails", () => {
  it.each(FAILS)("fails %j", (code) => {
    expect(messagesOf(code)).toContain(flag("force"));
  });

  it("reports each flag once, by its own name", () => {
    expect(messagesOf("export function run(a: boolean, b: string, c = true): void {}")).toStrictEqual([
      flag("a"),
      flag("c"),
    ]);
  });

  it("reports an overload and its implementation each", () => {
    expect(messagesOf(`${REPEATED};\n${REPEATED} {}`)).toStrictEqual([flag("force"), flag("force")]);
  });
});

describe("no-boolean-param passes", () => {
  it.each(PASSES)("passes %j", (code) => {
    expect(messagesOf(code)).toStrictEqual([]);
  });
});
