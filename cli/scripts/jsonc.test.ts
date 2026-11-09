import { describe, expect, it } from "vitest";
import { stripJsonc } from "./jsonc.ts";

describe("stripJsonc", () => {
  it("removes line and block comments", () => {
    const text = '{\n  // note\n  "a": 1, /* inline */ "b": [2]\n}';
    expect(JSON.parse(stripJsonc(text))).toEqual({ a: 1, b: [2] });
  });

  it("keeps comment markers inside strings", () => {
    const text = '{ "url": "http://localhost:3000", "glob": "src/**/*.ts", "q": "say \\"//hi\\"" } // tail';
    expect(JSON.parse(stripJsonc(text))).toEqual({
      url: "http://localhost:3000",
      glob: "src/**/*.ts",
      q: 'say "//hi"',
    });
  });

  it("keeps the newline that ends a line comment", () => {
    expect(stripJsonc("1 // x\n2")).toBe("1 \n2");
  });

  it("treats null and undefined as empty text", () => {
    expect(stripJsonc(null)).toBe("");
    expect(stripJsonc(undefined)).toBe("");
  });
});
