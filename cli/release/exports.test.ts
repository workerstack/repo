import { describe, expect, it } from "vitest";
import { exportSubpaths } from "./exports.ts";

const keys = (got: ReturnType<typeof exportSubpaths>) => got.subpaths.map((s) => s.key);

describe("exportSubpaths", () => {
  it("reads a string as the root export", () => {
    expect(exportSubpaths("./index.js", ["index.js"])).toStrictEqual({
      exports: 1,
      subpaths: [{ key: ".", runtime: "./index.js", types: null, kind: "code" }],
      errors: [],
    });
  });

  it("reads a condition object as the root export", () => {
    const got = exportSubpaths({ types: "./a.d.ts", default: "./a.js" }, []);
    expect(got.subpaths).toStrictEqual([{ key: ".", runtime: "./a.js", types: "./a.d.ts", kind: "code" }]);
  });

  it("reads an array as the root export, taking the first runtime and first types target", () => {
    const got = exportSubpaths([null, { types: "./t.d.ts" }, "./b.js"], []);
    expect(got.subpaths).toStrictEqual([{ key: ".", runtime: "./b.js", types: "./t.d.ts", kind: "code" }]);
  });
});

describe("exportSubpaths conditions", () => {
  it("takes nested import and require conditions and the nested types", () => {
    const got = exportSubpaths(
      {
        "./a": { import: { types: "./a.d.mts", default: "./a.mjs" }, require: "./a.cjs" },
        "./b": { require: "./b.cjs" },
        "./c": { default: { types: "./c.d.ts" } },
      },
      [],
    );
    expect(got.subpaths).toStrictEqual([
      { key: "./a", runtime: "./a.mjs", types: "./a.d.mts", kind: "code" },
      { key: "./b", runtime: "./b.cjs", types: null, kind: "code" },
    ]);
    expect(got.errors).toStrictEqual(["./c has a condition object with no default, import or require target"]);
  });

  it("finds no types in an array of plain strings", () => {
    expect(exportSubpaths({ "./a": ["./a.js"] }, []).subpaths).toStrictEqual([
      { key: "./a", runtime: "./a.js", types: null, kind: "code" },
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
    expect(got).toMatchObject({ exports: 1, errors: [] });
  });
});

describe("exportSubpaths patterns", () => {
  it("expands a * key to every matching file, in the types target too", () => {
    const files = ["cfg/a.json", "cfg/b.json", "cfg/c.txt", "cfg/sub/d.json", "t/a.d.ts"];
    const got = exportSubpaths({ "./cfg/*": { types: "./t/*.d.ts", default: "./cfg/*.json" } }, files);
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
    expect(got).toStrictEqual({ exports: 1, subpaths: [], errors: ["./agents/* matches no file in the tarball"] });
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
      exports: 0,
      subpaths: [],
      errors: ["package.json has no exports"],
    });
  });
});
