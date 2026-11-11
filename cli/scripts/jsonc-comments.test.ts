import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { cleanJsonDirs, jsonDir, readText } from "./fixtures/json-dirs.ts";
import { convertJsonc, convertText, firstOwnLine } from "./jsonc-comments.ts";

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
    for (const text of same) expect(convertText(text)).toStrictEqual({ first: null, text });
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

describe("convertJsonc", () => {
  it("rewrites the files and reports each first line; check reports without writing", () => {
    const root = jsonDir({
      "a.jsonc": TSCONFIG,
      "p.json": '{ "a": 1 }\n',
      "tsconfig.json": TSCONFIG,
      "x.ts": TSCONFIG,
    });
    const files = ["a.jsonc", "tsconfig.json", "p.json", "x.ts", "gone.json", "fixtures/f.jsonc"];
    expect(convertJsonc(root, files, true)).toStrictEqual([
      { file: "a.jsonc", line: 2 },
      { file: "tsconfig.json", line: 2 },
    ]);
    expect(readText(root, "a.jsonc")).toBe(TSCONFIG);
    expect(convertJsonc(root, files, false)).toHaveLength(2);
    expect([readText(root, "a.jsonc"), readText(root, "tsconfig.json")]).toStrictEqual([CONVERTED, CONVERTED]);
    expect([readText(root, "x.ts"), readText(root, "p.json")]).toStrictEqual([TSCONFIG, '{ "a": 1 }\n']);
    expect(convertJsonc(root, files, false)).toStrictEqual([]);
  });

  it("leaves a fixtures file alone", () => {
    const root = jsonDir({ "fixtures/f.jsonc": TSCONFIG });
    spawnSync("git", ["add", "-A"], { cwd: root });
    expect(convertJsonc(root, ["fixtures/f.jsonc"], false)).toStrictEqual([]);
    expect(fs.readFileSync(path.join(root, "fixtures/f.jsonc"), "utf8")).toBe(TSCONFIG);
  });
});
