import { expect, it } from "vitest";
import { SORTED, UNSORTED } from "./fixtures/json-dirs.ts";
import { sortedJsonText, sortedJsonValue } from "./json-keys.ts";

it("sorts nested keys, keeps arrays in order and sorts the objects inside them", () => {
  expect(sortedJsonText('{"b":1,"a":{"z":[3,{"y":1,"x":2},1],"c":1}}')).toEqual({
    text: '{"a":{"c":1,"z":[3,{"x":2,"y":1},1]},"b":1}',
    key: "a",
  });
  expect(sortedJsonText(UNSORTED)).toEqual({ text: SORTED, key: "hooks" });
});

it("names the first key out of order by its path, through objects and array indexes", () => {
  expect(sortedJsonText('{"a":1,"hooks":{"Stop":1,"Pre":2}}')?.key).toBe("hooks.Pre");
  expect(sortedJsonText('{"list":[{"b":1,"a":2}]}')?.key).toBe("list.0.a");
});

it("keeps the layout of the file: members move with their own text and separators stay where they were", () => {
  const text = '{\n  "b": 1,\n  "a": { "d": 1, "c": [3,  2] }\n}\n';
  expect(sortedJsonText(text)?.text).toBe('{\n  "a": { "c": [3,  2], "d": 1 },\n  "b": 1\n}\n');
});

it("orders by code unit, not by locale or by number", () => {
  expect(sortedJsonText('{"a":1,"B":2,"_":3}')?.text).toBe('{"B":2,"_":3,"a":1}');
  expect(sortedJsonText('{"2":1,"10":2}')?.text).toBe('{"10":2,"2":1}');
});

it("reads strings, escapes, literals and numbers as they are written", () => {
  expect(sortedJsonText('{"b":"x\\"}{,","a":"\\\\"}')?.text).toBe('{"a":"\\\\","b":"x\\"}{,"}');
  expect(sortedJsonText('{"b":1,"\\u0061":2}')?.text).toBe('{"\\u0061":2,"b":1}');
  expect(sortedJsonText('{"d":12345678901234567890,"c":true,"b":null,"a":-1.5e3}')?.text).toBe(
    '{"a":-1.5e3,"b":null,"c":true,"d":12345678901234567890}',
  );
});

it("handles empty containers and a document that is an array, with its surrounding whitespace", () => {
  expect(sortedJsonText('{"b":{},"a":[]}')?.text).toBe('{"a":[],"b":{}}');
  expect(sortedJsonText('  [{"b":1,"a":2}]\n')?.text).toBe('  [{"a":2,"b":1}]\n');
});

it("is null for a document already in order, a scalar, and anything that is not strict JSON", () => {
  expect(sortedJsonText(SORTED)).toBeNull();
  expect(sortedJsonText('{"a":1,"a":0}')).toBeNull();
  expect(sortedJsonText("3")).toBeNull();
  expect(sortedJsonText('{\n  // note\n  "b": 1,\n  "a": 2\n}\n')).toBeNull();
  expect(sortedJsonText('{"b":1,"a":2,}')).toBeNull();
  expect(sortedJsonText("")).toBeNull();
});

it("sortedJsonValue is the value as indented JSON, every key sorted by code unit, deep, ending in a newline", () => {
  expect(sortedJsonValue({ a: 1 })).toBe('{\n  "a": 1\n}\n');
  expect(sortedJsonValue({ b: 1, a: { d: [1], c: 2 }, B: {} })).toBe(
    '{\n  "B": {},\n  "a": {\n    "c": 2,\n    "d": [\n      1\n    ]\n  },\n  "b": 1\n}\n',
  );
  expect(sortedJsonValue({ b: 1, a: 2 }, 4)).toBe('{\n    "a": 2,\n    "b": 1\n}\n');
});
