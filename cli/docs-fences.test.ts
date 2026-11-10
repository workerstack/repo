import { expect, it } from "vitest";
import { firstGroup, splitMarkdown } from "./docs-fences.ts";

it("separates prose from fences, with each fence's line and info", () => {
  const text = ["# T", "```ts run", "a", "```", "after", "````md", "```", "x", "````"].join("\n");
  const { prose, fences } = splitMarkdown(text);
  expect(prose.map((one) => one.line)).toEqual([1, 5]);
  expect(fences).toEqual([
    { info: "ts run", start: 2, body: ["a"] },
    { info: "md", start: 6, body: ["```", "x"] },
  ]);
});

it("closes a fence left open at the end", () => {
  const { prose, fences } = splitMarkdown("```json\n{}\n");
  expect(fences).toEqual([{ info: "json", start: 1, body: ["{}", ""] }]);
  expect(prose).toEqual([]);
});

it("reads a triple tick inside a line as prose", () => {
  expect(splitMarkdown("```code``` here").prose).toHaveLength(1);
});

it("returns the group an alternation matched", () => {
  const [match] = "x".matchAll(/(a)|(x)/g);
  expect(match === undefined ? "" : firstGroup(match)).toBe("x");
});
