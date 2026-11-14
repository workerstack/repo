import { describe, expect, it } from "vitest";

import { owns, parallelGroupErrors } from "./parallel-groups.ts";

function overlapOf(one: string, two: string) {
  return parallelGroupErrors(
    [
      { files: [one], id: "1" },
      { files: [two], id: "2" },
    ],
    "slice",
  );
}

describe("parallelGroupErrors overlap", () => {
  it.each([
    ["src/cli.ts", "src/"],
    ["cli/init.ts", "cli/*.ts"],
    ["a/*.ts", "a/*.md"],
    ["docs/**/x.md", "docs/a/b/x.md"],
    ["src", "src/"],
  ])("finds %s and %s overlapping", (one, two) => {
    expect(overlapOf(one, two)).toStrictEqual([
      `parallel slices 1 and 2 overlap at ${one} and ${two}; parallel slices need disjoint paths`,
    ]);
  });

  it.each([
    ["cli/bench/", "cli/*.ts"],
    ["src/a.ts", "src/b.ts"],
    ["src/a.ts", "src/a.ts/x"],
    ["docs/**/x.md", "docs/a/y.md"],
  ])("keeps %s and %s apart", (one, two) => {
    expect(overlapOf(one, two)).toStrictEqual([]);
  });

  it("words phases with files", () => {
    const errors = parallelGroupErrors([{ files: [], id: "4" }], "phase");
    expect(errors).toStrictEqual([
      "phase 4 is parallel alone; parallel needs two or more adjacent phases",
      "phase 4 is parallel with no files; list the files it writes after parallel:",
    ]);
  });
});

describe("owns", () => {
  it("holds a file under a folder or matched by a glob, read with either separator", () => {
    expect(owns("src/", "src\\deep\\cli.ts")).toBe(true);
    expect(owns("cli/*.ts", "cli/a.ts")).toBe(true);
    expect(owns("cli/*.ts", "cli/b/c.ts")).toBe(false);
    expect(owns("cli/a.ts", "cli/a.ts")).toBe(true);
  });
});
