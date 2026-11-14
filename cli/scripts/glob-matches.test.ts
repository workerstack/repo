import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { fileTree } from "./__fixtures__/file-tree.ts";
import { globMatches } from "./glob-matches.ts";
import { globTokens } from "./shell-glob.ts";
import { wordAt } from "./shell-lex-word.ts";

/** A temp dir holding `dist/`, `src/a.ts`, `src/b.md`, `.hidden` and `bun.lock`, removed after the test. */
function tree(): string {
  return fileTree(["dist/", "src/a.ts", "src/b.md", ".hidden", "bun.lock"]);
}

/** The paths the word `src` matches from `dir`. */
function matches(src: string, dir: string, p: typeof path = path): string[] | null {
  const got = globTokens(wordAt(src, 0).word);

  return got === null ? null : globMatches(got, dir, p);
}

describe("globMatches: matching", () => {
  it("lists the sorted names a pattern matches from the dir, a leading dot typed", () => {
    const dir = tree();

    expect(matches("*", dir)).toStrictEqual(["bun.lock", "dist", "src"]);
    expect(matches(".*", dir)).toStrictEqual([".hidden"]);
    expect(matches("src/*.ts", dir)).toStrictEqual(["src/a.ts"]);
    expect(matches("*/a.ts", dir)).toStrictEqual(["src/a.ts"]);
    expect(matches("*/", dir)).toStrictEqual(["dist/", "src/"]);
    expect(matches("bun.l*", dir)).toStrictEqual(["bun.lock"]);
  });

  it("gives no match for a pattern that matches nothing or a dir that is not there", () => {
    const dir = tree();

    expect(matches("nope*", dir)).toStrictEqual([]);
    expect(matches("src/*/x", dir)).toStrictEqual([]);
    expect(matches("*", path.join(dir, "gone"))).toStrictEqual([]);
  });
});

describe("globMatches: where a search starts and stops", () => {
  it("starts an absolute pattern at the root", () => {
    const dir = tree().replaceAll("\\", "/");

    expect(matches(`${dir}/s*`, "/elsewhere")).toStrictEqual([`${dir}/src`]);
  });

  it("starts a pattern that names a Windows drive at that drive", () => {
    expect(matches("C:/no-such-glob-dir/*", String.raw`C:\r`, path.win32)).toStrictEqual([]);
    expect(matches("*", String.raw`C:\no-such-glob-dir`, path.win32)).toStrictEqual([]);
  });

  it("gives null for an unknown part and past 20,000 dir entries", () => {
    const dir = tree();
    const big = path.join(dir, "big");
    fs.mkdirSync(big);

    for (let i = 0; i <= 20_000; i++) fs.writeFileSync(path.join(big, String(i)), "");

    expect(matches("$X*", dir)).toBeNull();
    expect(matches("big/*", dir)).toBeNull();
  });
});
