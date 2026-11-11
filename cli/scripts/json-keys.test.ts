import { expect, it } from "vitest";

import { sortedJsonValue } from "./json-keys.ts";

it("sortedJsonValue is the value as indented JSON, every key sorted by code unit, deep, ending in a newline", () => {
  expect(sortedJsonValue({ a: 1 })).toBe('{\n  "a": 1\n}\n');
  expect(sortedJsonValue({ B: {}, a: { c: 2, d: [1] }, b: 1 })).toBe(
    '{\n  "B": {},\n  "a": {\n    "c": 2,\n    "d": [\n      1\n    ]\n  },\n  "b": 1\n}\n',
  );
  expect(sortedJsonValue({ a: 2, b: 1 }, 4)).toBe('{\n    "a": 2,\n    "b": 1\n}\n');
});
