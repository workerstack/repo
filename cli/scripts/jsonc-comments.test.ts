import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cleanJsonDirs, jsonDir, readText } from "./fixtures/json-dirs.ts";
import { convertJsonc, convertText, firstOwnLine, repoJsonc } from "./jsonc-comments.ts";

afterEach(cleanJsonDirs);

describe("convertText", () => {
  it("rewrites an own-line comment at its indent and keeps the rest byte for byte", () => {
    const text = '{\n  /*\n   * why\n   * so\n   */\n  "a": 1, /* inline */\n  "b": "/* in a string */"\n}\n';
    const out = convertText(text);
    expect(out.text).toBe('{\n  // why\n  // so\n  "a": 1, /* inline */\n  "b": "/* in a string */"\n}\n');
    expect(out.first).toBe(2);
  });

  it("leaves docs, a code-sharing comment, a leading license and plain json alone", () => {
    const same = [
      '{\n  /** doc */\n  "a": 1\n}\n',
      '{\n  /* a */ "a": 1\n}\n',
      '{\n  "a": 1 /* b */\n}\n',
      '/*! license */\n{ "a": 1 }\n',
      '{ "a": 1 }\n',
    ];
    for (const text of same) expect(convertText(text)).toEqual({ text, first: null });
  });

  it("converts two comments in a row and a comment at the end with no newline", () => {
    expect(convertText("{}\n/* a */\n  /* b */").text).toBe("{}\n// a\n  // b");
  });

  it("keeps a CRLF file's line ends", () => {
    expect(convertText('{\r\n  /* a */\r\n  "x": 1\r\n}\r\n').text).toBe('{\r\n  // a\r\n  "x": 1\r\n}\r\n');
  });

  it("firstOwnLine names the first comment's line", () => {
    expect(firstOwnLine("{}\n\n/* a */\n/* b */\n")).toBe(3);
    expect(firstOwnLine("{}")).toBeNull();
  });
});

const TSCONFIG = '{\n  /* base */\n  "extends": "x"\n}\n';
const CONVERTED = '{\n  // base\n  "extends": "x"\n}\n';

describe("repoJsonc", () => {
  it("lists json and jsonc, tracked or not, skips fixtures dirs, and narrows to paths", () => {
    const root = jsonDir({
      "a.jsonc": "{}",
      "dir/b.json": "{}",
      "fixtures/c.jsonc": "{}",
      "dir/fixtures/d.json": "{}",
      "e.ts": "",
    });
    expect(repoJsonc(root, null)).toEqual(["a.jsonc", "dir/b.json"]);
    expect(repoJsonc(root, ["dir"])).toEqual(["dir/b.json"]);
  });

  it("lists nothing outside a git repo", () => {
    expect(repoJsonc(jsonDir({ "a.json": "{}" }, false), null)).toEqual([]);
  });
});

describe("convertJsonc", () => {
  it("rewrites the files and reports each first line; check reports without writing", () => {
    const root = jsonDir({
      "a.jsonc": TSCONFIG,
      "tsconfig.json": TSCONFIG,
      "p.json": '{ "a": 1 }\n',
      "x.ts": TSCONFIG,
    });
    const files = ["a.jsonc", "tsconfig.json", "p.json", "x.ts", "gone.json", "fixtures/f.jsonc"];
    expect(convertJsonc(root, files, true)).toEqual([
      { file: "a.jsonc", line: 2 },
      { file: "tsconfig.json", line: 2 },
    ]);
    expect(readText(root, "a.jsonc")).toBe(TSCONFIG);
    expect(convertJsonc(root, files, false)).toHaveLength(2);
    expect([readText(root, "a.jsonc"), readText(root, "tsconfig.json")]).toEqual([CONVERTED, CONVERTED]);
    expect([readText(root, "x.ts"), readText(root, "p.json")]).toEqual([TSCONFIG, '{ "a": 1 }\n']);
    expect(convertJsonc(root, files, false)).toEqual([]);
  });

  it("leaves a fixtures file alone", () => {
    const root = jsonDir({ "fixtures/f.jsonc": TSCONFIG });
    spawnSync("git", ["add", "-A"], { cwd: root });
    expect(convertJsonc(root, ["fixtures/f.jsonc"], false)).toEqual([]);
    expect(fs.readFileSync(path.join(root, "fixtures/f.jsonc"), "utf8")).toBe(TSCONFIG);
  });
});
