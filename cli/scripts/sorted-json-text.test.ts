import { expect, it } from "vitest";
import { SORTED, UNSORTED } from "./fixtures/json-dirs.ts";
import { sortedJsonText } from "./sorted-json-text.ts";

const text = (input: string): string | undefined => sortedJsonText(input)?.text;

it("sorts nested keys, keeps arrays in order and sorts the objects inside them", () => {
  expect(sortedJsonText('{"b":1,"a":{"z":[3,{"y":1,"x":2},1],"c":1}}')).toStrictEqual({
    text: '{"a":{"c":1,"z":[3,{"x":2,"y":1},1]},"b":1}',
    key: "a",
  });
  expect(sortedJsonText(UNSORTED)).toStrictEqual({ text: SORTED, key: "hooks" });
});

it("names the first key out of order by its path, through objects and array indexes", () => {
  expect(sortedJsonText('{"a":1,"hooks":{"Stop":1,"Pre":2}}')?.key).toBe("hooks.Pre");
  expect(sortedJsonText('{"list":[{"b":1,"a":2}]}')?.key).toBe("list.0.a");
});

it("keeps the layout of the file: members move with their own text and separators stay where they were", () => {
  const input = '{\n  "b": 1,\n  "a": { "d": 1, "c": [3,  2] }\n}\n';
  expect(text(input)).toBe('{\n  "a": { "c": [3,  2], "d": 1 },\n  "b": 1\n}\n');
});

it("orders by code unit, not by locale or by number", () => {
  expect(text('{"a":1,"B":2,"_":3}')).toBe('{"B":2,"_":3,"a":1}');
  expect(text('{"2":1,"10":2}')).toBe('{"10":2,"2":1}');
});

it("reads strings, escapes, literals and numbers as they are written", () => {
  expect(text('{"b":"x\\"}{,","a":"\\\\"}')).toBe('{"a":"\\\\","b":"x\\"}{,"}');
  expect(text('{"b":1,"\\u0061":2}')).toBe('{"\\u0061":2,"b":1}');
  expect(text('{"d":12345678901234567890,"c":true,"b":null,"a":-1.5e3}')).toBe(
    '{"a":-1.5e3,"b":null,"c":true,"d":12345678901234567890}',
  );
});

it("handles empty containers and a document that is an array, with its surrounding whitespace", () => {
  expect(text('{"b":{},"a":[]}')).toBe('{"a":[],"b":{}}');
  expect(text('  [{"b":1,"a":2}]\n')).toBe('  [{"a":2,"b":1}]\n');
});

it("is null for a document already in order, a scalar, and an empty text", () => {
  expect(sortedJsonText(SORTED)).toBeNull();
  expect(sortedJsonText('{"a":1,"a":0}')).toBeNull();
  expect(sortedJsonText("3")).toBeNull();
  expect(sortedJsonText("")).toBeNull();
});

it("is null for text that does not parse as JSONC", () => {
  expect(sortedJsonText('{"b":1,"a":}')).toBeNull();
  expect(sortedJsonText('{"b":1 "a":2}')).toBeNull();
  expect(sortedJsonText('{"b":1,"a":2')).toBeNull();
});

it("sorts the Usage tsconfig: comments move with their key and the trailing comma stays last by position", () => {
  const input =
    '{\n  "include": ["src"], // what tsc reads\n  // the base\n  "extends": "./base.json",\n  // kept for later\n}\n';
  expect(sortedJsonText(input)).toStrictEqual({
    text: '{\n  // the base\n  "extends": "./base.json",\n  "include": ["src"], // what tsc reads\n  // kept for later\n}\n',
    key: "extends",
  });
});

it("moves an own-line comment above a nested key with that key", () => {
  const input = '{\n  "a": {\n    "z": 1,\n    // about y\n    "y": 2\n  }\n}\n';
  expect(sortedJsonText(input)).toStrictEqual({
    text: '{\n  "a": {\n    // about y\n    "y": 2,\n    "z": 1\n  }\n}\n',
    key: "a.y",
  });
});

it("moves a comment trailing on a key's line with that key", () => {
  expect(text('{\n  "b": 1, // why b\n  "a": 2 // why a\n}\n')).toBe('{\n  "a": 2, // why a\n  "b": 1 // why b\n}\n');
});

it("moves a block comment between a value and its comma with the key, the comma staying by position", () => {
  expect(text('{\n  "b": 1 /* why */,\n  "a": 2\n}\n')).toBe('{\n  "a": 2,\n  "b": 1 /* why */\n}\n');
});

it("moves a block comment trailing after the comma with the key", () => {
  expect(text('{\n  "b": 1, /* why b */\n  "a": 2\n}\n')).toBe('{\n  "a": 2,\n  "b": 1 /* why b */\n}\n');
});

it("leaves a trailing comma last by position", () => {
  expect(text('{\n  "b": 1,\n  "a": 2,\n}\n')).toBe('{\n  "a": 2,\n  "b": 1,\n}\n');
});

it("keeps a comment with no key after it last in its object", () => {
  expect(text('{\n  "b": 1,\n  "a": 2\n  // nothing follows\n}\n')).toBe(
    '{\n  "a": 2,\n  "b": 1\n  // nothing follows\n}\n',
  );
});

it("keeps a comment after the opening brace on its line with the brace", () => {
  expect(text('{ // top\n  "b": 1,\n  "a": 2\n}\n')).toBe('{ // top\n  "a": 2,\n  "b": 1\n}\n');
});

it("keeps a comment before the first key of a one-line object with that key", () => {
  expect(text('{ /* x */ "b": 1, "a": 2 }')).toBe('{ "a": 2, /* x */ "b": 1 }');
});

it("keeps a block comment before a key on the same line before that key", () => {
  expect(text('{"b":1, /* x */ "a":2}')).toBe('{/* x */ "a":2, "b":1}');
});

it("gives a line-comment trail a line break when it lands before a closing brace on its line", () => {
  expect(text('{\n  "b": 1, // why b\n  "a": 2 }')).toBe('{\n  "a": 2,\n  "b": 1 // why b\n }');
});

it("gives a line-comment trail a line break when the key it lands on is followed by a key on its line", () => {
  expect(text('{\n  "b": 1, // why b\n  "a": 3, "c": 2\n}\n')).toBe('{\n  "a": 3,\n  "b": 1, // why b\n "c": 2\n}\n');
});

it("keeps CRLF line endings, also for an added line break", () => {
  expect(text('{\r\n  "b": 1, // why b\r\n  "a": 2 }')).toBe('{\r\n  "a": 2,\r\n  "b": 1 // why b\r\n }');
  expect(text('{\r\n  // a\r\n  "b": 1,\r\n  "a": 2\r\n}\r\n')).toBe('{\r\n  "a": 2,\r\n  // a\r\n  "b": 1\r\n}\r\n');
});

it("keeps arrays in order and sorts the objects inside them, comments included", () => {
  const input = '[\n  // first\n  { "b": 1, "a": 2 },\n  { "d": 1, /* c */ "c": 2 }\n]\n';
  expect(sortedJsonText(input)).toStrictEqual({
    text: '[\n  // first\n  { "a": 2, "b": 1 },\n  { /* c */ "c": 2, "d": 1 }\n]\n',
    key: "0.a",
  });
});

it("is null for sorted JSONC", () => {
  expect(sortedJsonText('{\n  // note\n  "a": 1, // one\n  "b": 2,\n}\n')).toBeNull();
});
