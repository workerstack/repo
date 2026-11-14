import { describe, expect, it } from "vitest";

import { globText, globTokens, isLitToken, isMatchToken, segmentRegExp } from "./shell-glob.ts";
import { wordAt } from "./shell-lex-word.ts";

/** The tokens of the word `src`, each as `pat:raw:re`, `lit:text`, or `part:raw`; null when it holds no pattern. */
function tokens(src: string): string[] | null {
  return (
    globTokens(wordAt(src, 0).word)?.map((t) => {
      if (t.kind === "pat") return `pat:${t.raw}:${t.re}`;

      return t.kind === "lit" ? `lit:${t.text}` : `part:${t.part.raw}`;
    }) ?? null
  );
}

describe("globTokens", () => {
  it("reads *, ? and a closed bracket in unquoted text as a pattern", () => {
    expect(tokens("*.ts")).toStrictEqual(["pat:*:[^/]*", "lit:.ts"]);
    expect(tokens("a?")).toStrictEqual(["lit:a", "pat:?:[^/]"]);
    expect(tokens("a[bc]d")).toStrictEqual(["lit:a", "pat:[bc]:[bc]", "lit:d"]);
    expect(tokens("[!a]x")).toStrictEqual(["pat:[!a]:[^/a]", "lit:x"]);
    expect(tokens("[^a]")).toStrictEqual(["pat:[^a]:[^/a]"]);
    expect(tokens("[]a]")).toStrictEqual(["pat:[]a]:[\\]a]"]);
    expect(tokens("[[:digit:]_]")).toStrictEqual(["pat:[[:digit:]_]:[0-9_]"]);
    expect(tokens("[[:nope:]]")).toStrictEqual(["pat:[[:nope:]]:[^/]"]);
  });

  it("reads quoted or escaped pattern characters, an open bracket, and one across a slash as text", () => {
    for (const src of ["'*'.ts", String.raw`\*.ts`, '"a?"', "a[b", "a[b/c]", "a'['b]", "plain"])
      expect(tokens(src), src).toBeNull();
  });

  it("keeps an unknown part in a pattern", () => {
    expect(tokens("$X/*")).toStrictEqual(["part:$X", "lit:/", "pat:*:[^/]*"]);
  });
});

/** The word `src` as `globText` writes its pattern; null when it holds none. */
function text(src: string): string | null {
  const got = globTokens(wordAt(src, 0).word);

  return got === null ? null : globText(got);
}

describe("globText and segmentRegExp", () => {
  it("writes a pattern with each character that matches only itself escaped", () => {
    expect(text("a'*'*")).toBe(String.raw`a\**`);
    expect(text("'a?'[x]")).toBe(String.raw`a\?[x]`);
    expect(text("$X/*")).toBe("$X/*");
  });

  it("matches one segment as bash matches a name: a leading dot must be typed", () => {
    const star = segmentRegExp("*");

    expect([star?.test("dist"), star?.test(".git")]).toStrictEqual([true, false]);
    expect(segmentRegExp(".*")?.test(".git")).toBe(true);
    expect(segmentRegExp("d?st")?.test("dist")).toBe(true);
    expect(segmentRegExp("[[:nope:]]ist")?.test("dist")).toBe(true);
    expect(segmentRegExp(String.raw`a\*`)).toBeNull();
    expect(segmentRegExp(String.raw`\.*`)?.test(".git")).toBe(true);
    expect(segmentRegExp("a.(b)*")?.test("a.(b)c")).toBe(true);
  });
});

describe("isMatchToken and isLitToken", () => {
  it("tell a token a disk search can match from an unknown part, and text from pattern syntax", () => {
    const part = { kind: "part", part: { kind: "param", quoted: false, raw: "$X", substs: [] } } as const;
    const pat = { kind: "pat", raw: "*", re: "[^/]*" } as const;
    const lit = { bash: "a", kind: "lit", text: "a" } as const;

    expect(isMatchToken(part)).toBe(false);
    expect(isMatchToken(pat)).toBe(true);
    expect(isMatchToken(lit)).toBe(true);
    expect(isLitToken(pat)).toBe(false);
    expect(isLitToken(lit)).toBe(true);
  });
});
