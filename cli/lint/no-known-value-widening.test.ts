import { describe, expect, it } from "vitest";

import { reportsOf } from "../../dev/rule-harness.ts";
import { noKnownValueWidening } from "./no-known-value-widening.ts";

/** The target kinds the message names. */
type Target = "anonymous object" | "generic container" | "object" | "open dictionary" | "unknown";

/** One finding: the kind of type the value flows into and the subject the message names. */
type Flow = readonly [Target, string];

function messageOf([target, subject]: Flow): string {
  return (
    `The explicit ${target} type on ${subject} discards known type evidence. ` +
    "Keep inference, validate with `satisfies`, or use a named owner contract."
  );
}

function messagesOf(code: string): string[] {
  return reportsOf(noKnownValueWidening, { "a.ts": code }).map((report) => report.message);
}

const PRELUDE = "type Command = () => void; const startCommand = () => {};";
const START = "{ start: startCommand }";
const COMMANDS = "binding `commands`";
const VALUE = "binding `value`";
const CREATE = "return value of `create`";
const PROPERTY = "property `commands`";
const GUARD = "function isString(value: unknown): value is string { return true; }";
const IS_STRING = "argument for parameter `value` of `isString`";
const ANONYMOUS_ARGUMENT = "argument for parameter `value` of `anonymous function`";

/** Each code after `PRELUDE`, which declares `Command` and `startCommand`. */
function preluded(...codes: string[]): string[] {
  return codes.map((code) => `${PRELUDE} ${code}`);
}

/** anti-slop's valid cases, then the port's own. */
const PASSES = [
  ...preluded(
    "const commands: Record<string, Command> = {};",
    "type Index<T> = Record<string, T>; const commands: Index<Command> = {};",
    "class Registry { commands: Record<string, Command> = {}; }",
    "class Registry { accessor commands: Record<string, Command> = {}; }",
    "let commands: Record<string, Command>; commands = {};",
    "function create(): Record<string, Command> { return {}; }",
    "const create = (): Record<string, Command> => ({});",
    "const commands = {} as Record<string, Command>;",
    "const commands = <Record<string, Command>>{};",
    `const commands = ${START};`,
    `const commands = ${START} as const;`,
    `const commands = ${START} satisfies Record<string, Command>;`,
    `type Commands = Record<string, Command>; const commands = ${START} as const satisfies Commands;`,
    `interface Commands { readonly start: Command } const commands: Commands = ${START};`,
    `type Commands = { readonly start: Command }; const commands: Commands = ${START};`,
    "type PermissionLevels = { readonly [Level in Permission]: number }; " +
      "const levels: PermissionLevels = { admin: 1 };",
    `function create() { return ${START}; }`,
    `interface Commands { readonly start: Command } function create(): Commands { return ${START}; }`,
    "declare function make(): Record<string, Command>; const commands: Record<string, Command> = make();",
    `import { Commands } from './types'; const commands: Commands = ${START};`,
    "type Diet = 'vegan' | 'omnivore'; const labels: Record<Diet, string> = { vegan: 'V', omnivore: 'O' };",
    "type Diet = 'vegan' | 'omnivore'; type Labels = Record<Diet, string>; " +
      "const labels: Labels = { vegan: 'V', omnivore: 'O' };",
    "type Diet = 'vegan' | 'omnivore'; const labels: Readonly<Record<Diet, string>> = { vegan: 'V', omnivore: 'O' };",
    "const labels: Record<'a' | 'b', number> = { a: 1, b: 2 };",
    "type Index<Key extends PropertyKey, Value> = Record<Key, Value>; " +
      `const commands: Index<'start', Command> = ${START};`,
  ),
  "function isString(value: unknown): value is string { return true; } declare const input: unknown; isString(input);",
  "function isString(value: string | unknown): value is string { return true; } " +
    "declare const input: string | unknown; isString(input);",
  "function isString(value: unknown): value is string { return true; } " +
    "declare function readInput(): unknown; isString(readInput());",
  // the port's own: a value nothing pins, a target that keeps its evidence, or a call no local predicate owns
  "function wrap(input: string) { const value: unknown = input; }",
  "let source = { id: 1 }; const value: object = source;",
  "const first = second; const second = first; const value: unknown = first;",
  "const value: Readonly = { id: 1 };",
  "const value: {} = { id: 1 };",
  "type Pair = [string]; const pair: Pair = ['a'];",
  "type Open = Missing; const value: Open = { id: 1 };",
  "type Key<T> = string; const value: Record<Key<1>, number> = { id: 1 };",
  "const value: Record<Keys.Name, number> = { id: 1 };",
  "type Open = Types.Dictionary; const value: Open = { id: 1 };",
  "type Wrap<T> = T; function make<T>(): void { const value: Wrap<T> = { id: 1 }; }",
  "class Registry { commands: Record<string, number>; }",
  "function create(): unknown { return; }",
  "return { id: 1 };",
  "undeclared = { id: 1 };",
  "let total: unknown; total += 1;",
  "function reset(value: unknown) { value = {}; }",
  `${GUARD} isString(Math);`,
  `${GUARD} isString(undeclared);`,
  `${GUARD} isString(input as unknown);`,
  `${GUARD} var known = 'a'; var known = 'b'; isString(known);`,
  `${GUARD} function known() {} isString(known);`,
  `${GUARD} function check(known) { return isString(known); }`,
  `${GUARD} function read() { return 'known'; } isString(read());`,
  `${GUARD} const first = second; const second = first; isString(first);`,
  `${GUARD} isString(...values);`,
  `${GUARD} isString();`,
  "function isString(value): value is string { return true; } isString('known');",
  "function isString(value: string | number): value is string { return true; } isString('known');",
  "function isFull(this: Box): this is Full { return true; } isFull('known');",
  "function parse(value) {} parse('known');",
  "declare const isString: (value: unknown) => value is string; isString('known');",
  "const isString = makeGuard(); isString('known');",
  "function check(isString: (value: unknown) => value is string) { isString('known'); }",
  "guards.isString('known');",
];

/** Each of `codes`, with the one finding it reports: a known value written into a `target` type on `subject`. */
function fails(target: Target, subject: string, ...codes: string[]): (readonly [string, Flow])[] {
  return codes.map((code) => [code, [target, subject]]);
}

/** Each of `codes` after `PRELUDE`, with the one finding it reports. */
function failsAfterPrelude(target: Target, subject: string, ...codes: string[]): (readonly [string, Flow])[] {
  return fails(target, subject, ...preluded(...codes));
}

/** anti-slop's invalid cases, then the port's own, by the one finding each reports. */
const FAILS = [
  ...fails("unknown", VALUE, "const value: unknown = {};", "let value: unknown; value = {};"),
  ...fails("unknown", VALUE, "const value: unknown = 1;", "const value: unknown = -1;"),
  ...fails("unknown", VALUE, "type Top = unknown; const value: Top = {};"),
  ...fails("object", VALUE, "const value: object = {};", "const value: object = [];"),
  ...fails("unknown", CREATE, "function create(): unknown { return {}; }"),
  ...failsAfterPrelude(
    "open dictionary",
    COMMANDS,
    `const commands: Record<string, Command> = ${START};`,
    `const commands: { [key: string]: Command } = ${START};`,
    `const commands: { [K in string]: Command } = ${START};`,
    `let commands: Record<string, Command>; commands = ${START};`,
    `const source = ${START}; const commands: Record<string, Command> = source;`,
    `type Open = Record<string, Command>; const source = ${START}; const commands: Open = source;`,
    `type Open = { [key: string]: Command }; const source = ${START}; const commands: Open = source;`,
    `type Open = { [key in string]: Command }; const source = ${START}; const commands: Open = source;`,
    `type Open = Readonly<Record<string, Command>>; const source = ${START}; const commands: Open = source;`,
    `function outer() { type Open = Record<string, Command>; const commands: Open = ${START}; }`,
    `type Index<T> = Record<string, T>; type CommandsByName = Index<Command>; ` +
      `const commands: CommandsByName = ${START};`,
    `type Key = string; const commands: Record<Key, Command> = ${START};`,
    `const commands: Record<PropertyKey, Command> = ${START};`,
    `const commands: Record<string | 'start', Command> = ${START};`,
  ),
  ...failsAfterPrelude("anonymous object", COMMANDS, `const commands: { start: Command } = ${START};`),
  ...failsAfterPrelude("open dictionary", "assertion", `const commands = ${START} as Record<string, Command>;`),
  ...failsAfterPrelude("object", "assertion", `const commands = (${START} as Record<string, Command>) as object;`),
  ...failsAfterPrelude("open dictionary", PROPERTY, `class Registry { commands: Record<string, Command> = ${START}; }`),
  ...failsAfterPrelude("open dictionary", CREATE, `function create(): Record<string, Command> { return ${START}; }`),
  ...failsAfterPrelude("anonymous object", CREATE, `function create(): { start: Command } { return ${START}; }`),
  ...failsAfterPrelude(
    "generic container",
    COMMANDS,
    `type Index<T> = Record<string, T>; const commands: Index<Command> = ${START};`,
    `type Identity<T> = T; const commands: Identity<Record<string, Command>> = ${START};`,
    `type Index<T = Command> = Record<string, T>; const commands: Index = ${START};`,
  ),
  ...fails(
    "unknown",
    IS_STRING,
    `${GUARD} isString('known');`,
    `${GUARD} const known = 'known'; isString(known);`,
    "function isString(value: string | unknown): value is string { return true; } isString('known');",
    `${GUARD} function check(known: string): boolean { return isString(known); }`,
    "const isString = (value: unknown): value is string => true; const known: string = getValue(); isString(known);",
    `${GUARD} declare const input: string; isString(input as string);`,
    `${GUARD} isString('known'!);`,
    `${GUARD} function check(other: number, known: string) { return isString(known); }`,
    "function isString(other, value: unknown): value is string { return true; } isString(1, 'known');",
    "function isString(other: number, value: unknown): value is string { return true; } isString(1, 'known');",
  ),
  ...fails(
    "unknown",
    "argument for parameter `value` of `isUser`",
    "type User = { readonly id: string }; function isUser(value: unknown): value is User { return true; } " +
      "function parse(): User { return { id: 'known' }; } const user = parse(); isUser(user);",
  ),
  ...fails("open dictionary", VALUE, "const value: Record = { id: 1 };"),
  ...fails("anonymous object", VALUE, "const value: Readonly<{ id: number }> = { id: 1 };"),
  ...fails("object", PROPERTY, "class Registry { 'commands': object = {}; }"),
  ...fails("object", PROPERTY, "class Registry { #commands: object = {}; }"),
  ...fails("object", "property `Symbol.iterator`", "class Registry { [Symbol.iterator]: object = {}; }"),
  ...fails("unknown", "return value of `make`", "class Registry { make(): unknown { return {}; } }"),
  ...fails("unknown", "return value of `anonymous function`", "const registry = { make: (): unknown => ({}) };"),
  ...fails("unknown", ANONYMOUS_ARGUMENT, "((value: unknown): value is string => true)('known');"),
];

describe("no-known-value-widening", () => {
  it.each(FAILS)("fails %j", (code, flow) => {
    expect(messagesOf(code)).toStrictEqual([messageOf(flow)]);
  });

  it.each(PASSES)("passes %j", (code) => {
    expect(messagesOf(code)).toStrictEqual([]);
  });
});
