import { describe, expect, it } from "vitest";

import { exportSubpaths } from "./exports.ts";

/** An `exports` condition map. Conditions resolve in order, so `types` stays before `default`. */
const conditions = (types: string, runtime: string) => ({
  types,

  default: runtime,
});

const keys = (got: ReturnType<typeof exportSubpaths>) => got.subpaths.map((s) => s.key);

describe("exportSubpaths", () => {
  it("reads a string as the root export", () => {
    expect(exportSubpaths("./index.js", ["index.js"])).toStrictEqual({
      errors: [],
      exports: 1,
      subpaths: [{ key: ".", kind: "code", runtime: "./index.js", types: null }],
    });
  });

  it("reads a condition object as the root export", () => {
    const got = exportSubpaths(conditions("./a.d.ts", "./a.js"), []);
    expect(got.subpaths).toStrictEqual([{ key: ".", kind: "code", runtime: "./a.js", types: "./a.d.ts" }]);
  });

  it("reads an array as the root export, taking the first runtime and first types target", () => {
    const got = exportSubpaths([null, { types: "./t.d.ts" }, "./b.js"], []);
    expect(got.subpaths).toStrictEqual([{ key: ".", kind: "code", runtime: "./b.js", types: "./t.d.ts" }]);
  });
});

describe("exportSubpaths conditions", () => {
  it("takes nested import and require conditions and the nested types", () => {
    const got = exportSubpaths(
      {
        "./a": {
          import: conditions("./a.d.mts", "./a.mjs"),
          require: "./a.cjs",
        },
        "./b": { require: "./b.cjs" },
        "./c": { default: { types: "./c.d.ts" } },
      },
      [],
    );
    expect(got.subpaths).toStrictEqual([
      { key: "./a", kind: "code", runtime: "./a.mjs", types: "./a.d.mts" },
      { key: "./b", kind: "code", runtime: "./b.cjs", types: null },
    ]);
    expect(got.errors).toStrictEqual(["./c has a condition object with no default, import or require target"]);
  });

  it("finds no types in an array of plain strings", () => {
    expect(exportSubpaths({ "./a": ["./a.js"] }, []).subpaths).toStrictEqual([
      { key: "./a", kind: "code", runtime: "./a.js", types: null },
    ]);
  });
});

describe("exportSubpaths kinds", () => {
  it("uses a .ts string target as its own types and sorts json and other apart", () => {
    const got = exportSubpaths({ "./lint": "./x/lint.ts", "./p.json": "./p.json", "./r": "./README.md" }, []);
    expect(got.subpaths.map((s) => [s.key, s.types, s.kind])).toStrictEqual([
      ["./lint", "./x/lint.ts", "code"],
      ["./p.json", null, "json"],
      ["./r", null, "other"],
    ]);
  });

  it("leaves out a null target", () => {
    const got = exportSubpaths({ ".": "./a.js", "./internal/*": null }, []);
    expect(keys(got)).toStrictEqual(["."]);
    expect(got).toMatchObject({ errors: [], exports: 1 });
  });
});

describe("exportSubpaths patterns", () => {
  it("expands a * key to every matching file, in the types target too", () => {
    const files = ["cfg/a.json", "cfg/b.json", "cfg/c.txt", "cfg/sub/d.json", "t/a.d.ts"];
    const got = exportSubpaths(
      {
        "./cfg/*": conditions("./t/*.d.ts", "./cfg/*.json"),
      },
      files,
    );
    expect(got.subpaths.map((s) => [s.key, s.runtime, s.types])).toStrictEqual([
      ["./cfg/a", "./cfg/a.json", "./t/a.d.ts"],
      ["./cfg/b", "./cfg/b.json", "./t/b.d.ts"],
      ["./cfg/sub/d", "./cfg/sub/d.json", "./t/sub/d.d.ts"],
    ]);
    expect(got.exports).toBe(1);
  });

  it("expands a * key with a string target and escapes regex characters", () => {
    const got = exportSubpaths({ "./a/*": "./a.b/*" }, ["a.b/x", "aXb/y"]);
    expect(got.subpaths.map((s) => [s.key, s.types])).toStrictEqual([["./a/x", null]]);
  });
});

describe("exportSubpaths errors", () => {
  it("reports a * that matches no file", () => {
    const got = exportSubpaths({ "./agents/*": "./agents/*" }, ["README.md"]);
    expect(got).toStrictEqual({ errors: ["./agents/* matches no file in the tarball"], exports: 1, subpaths: [] });
  });

  it("reports an array with no runtime target", () => {
    expect(exportSubpaths({ "./a": [null, { types: "./a.d.ts" }] }, []).errors).toStrictEqual([
      "./a has a condition object with no default, import or require target",
    ]);
  });

  it("reports a condition object with no runtime target", () => {
    const got = exportSubpaths({ "./x": { types: "./x.d.ts" } }, []);
    expect(got.errors).toStrictEqual(["./x has a condition object with no default, import or require target"]);
  });

  it.each([undefined, null, 3])("reports %s as no exports", (value) => {
    expect(exportSubpaths(value, [])).toStrictEqual({
      errors: ["package.json has no exports"],
      exports: 0,
      subpaths: [],
    });
  });
});
