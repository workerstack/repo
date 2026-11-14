import { describe, expect, it } from "vitest";

import { braceWords } from "./brace-words.ts";
import type { Part } from "./shell-ast.types.ts";
import { wordAt } from "./shell-lex-word.ts";

/** A part as text: quoted text in `'…'`, other text and every other part as typed. */
function shown(p: Part): string {
  if (p.kind !== "lit") return p.raw;

  return p.quoted ? `'${p.bash}'` : p.bash;
}

/** The words bash makes of `src` by brace expansion, each part as `shown` gives it; null over the cap. */
function words(src: string): string[] | null {
  return braceWords(wordAt(src, 0).word)?.map((w) => w.parts.map(shown).join("")) ?? null;
}

describe("braceWords: lists", () => {
  it("makes one word per alternative, left to right, with the text around each", () => {
    expect(words("{a,b}")).toStrictEqual(["a", "b"]);
    expect(words("x{a,b}y")).toStrictEqual(["xay", "xby"]);
    expect(words("{a,b}{c,d}")).toStrictEqual(["ac", "ad", "bc", "bd"]);
    expect(words("a{,}b")).toStrictEqual(["ab", "ab"]);
  });

  it("expands nested braces, and leaves a brace with no comma or sequence as text", () => {
    expect(words("{a,{b,c}}")).toStrictEqual(["a", "b", "c"]);
    expect(words("{a,{b}}")).toStrictEqual(["a", "{b}"]);
    expect(words("{x{a,b}")).toStrictEqual(["{xa", "{xb"]);
  });

  it("leaves a word as it is when no brace expands", () => {
    for (const src of ["{a}", "{}", "{$X}", "{a,b", "a}b", "{1..x}", "{a..1}", "{1..2..x}"])
      expect(words(src), src).toStrictEqual([src]);
  });
});

describe("braceWords: text no brace syntax", () => {
  it("reads quoted and escaped text, and every expansion, as text no brace syntax", () => {
    expect(words("'{a,b}'")).toStrictEqual(["'{a,b}'"]);
    expect(words("{a,'b,c'}")).toStrictEqual(["a", "'b,c'"]);
    expect(words(String.raw`\{a,b}`)).toStrictEqual(["'{'a,b}"]);
    expect(words("${X}{a,b}")).toStrictEqual(["${X}a", "${X}b"]);
    expect(words("{$X,b}")).toStrictEqual(["$X", "b"]);
  });

  it("keeps the source word's raw and an alternative's pattern characters unquoted", () => {
    const got = braceWords(wordAt("{*,'?'}", 0).word);

    expect(got?.map((w) => w.raw)).toStrictEqual(["{*,'?'}", "{*,'?'}"]);
    expect(got?.map((w) => w.parts)).toStrictEqual([
      [{ bash: "*", kind: "lit", quoted: false, text: "*" }],
      [{ bash: "?", kind: "lit", quoted: true, text: "?" }],
    ]);
  });
});

describe("braceWords: sequences", () => {
  it("counts whole numbers up or down by the size of the step", () => {
    expect(words("{1..3}")).toStrictEqual(["1", "2", "3"]);
    expect(words("{3..1}")).toStrictEqual(["3", "2", "1"]);
    expect(words("{1..10..3}")).toStrictEqual(["1", "4", "7", "10"]);
    expect(words("{5..1..-2}")).toStrictEqual(["5", "3", "1"]);
    expect(words("{1..3..0}")).toStrictEqual(["1", "2", "3"]);
    expect(words("{-2..1}")).toStrictEqual(["-2", "-1", "0", "1"]);
  });

  it("pads every number to one width when an end has a leading zero", () => {
    expect(words("{01..03}")).toStrictEqual(["01", "02", "03"]);
    expect(words("{8..010}")).toStrictEqual(["008", "009", "010"]);
    expect(words("{-01..1}")).toStrictEqual(["-01", "000", "001"]);
  });

  it("counts single letters", () => {
    expect(words("{a..c}")).toStrictEqual(["a", "b", "c"]);
    expect(words("{e..a..2}")).toStrictEqual(["e", "c", "a"]);
  });
});

describe("braceWords: the cap", () => {
  it("expands up to 1,024 words and gives null past them", () => {
    expect(words("{1..1024}")).toHaveLength(1024);
    expect(words("{1..1025}")).toBeNull();
    expect(words("{1..40}{1..40}")).toBeNull();
    expect(words("{a,{1..1025}}")).toBeNull();
  });
});
