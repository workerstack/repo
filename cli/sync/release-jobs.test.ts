import { describe, expect, it } from "vitest";
import { HEADER, context } from "../fixtures/release-context.ts";
import { GENERATORS } from "./outputs.ts";
import { release } from "./release.ts";

const CI_PATH = ".github/workflows/ci.yml";

describe("release gates", () => {
  it("is a generator", () => {
    expect(GENERATORS).toContain(release);
  });

  it("writes nothing with the pack off", () => {
    expect(release(context(["agents", "standards", "docs"]))).toEqual({ outputs: [], errors: [] });
  });

  it("rewrites a ci.yml that has the generated header on its first line", () => {
    const result = release(context(["release"], {}, { [CI_PATH]: `${HEADER}\nname: old\n` }));
    expect(result.errors).toEqual([]);
    expect(result.outputs).toHaveLength(1);
  });

  it("refuses a hand-written ci.yml", () => {
    expect(release(context(["release"], {}, { [CI_PATH]: "name: ci\n" }))).toEqual({
      outputs: [],
      errors: [".github/workflows/ci.yml is hand-written; delete it so repo sync can own it"],
    });
  });
});
