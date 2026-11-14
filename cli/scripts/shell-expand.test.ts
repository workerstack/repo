import { describe, expect, it } from "vitest";

import type { Value, Vars } from "./shell-ast.types.ts";
import { expandWord, lookup, valueOf } from "./shell-expand.ts";
import { wordAt } from "./shell-lex-word.ts";

/** A known value. */
function v(text: string): Value {
  return { known: true, text };
}

const VARS: Vars = new Map([
  ["HOME", v("/h")],
  ["PWD", v("/r")],
  ["IFS", v(" \t\n")],
  ["X", v("x")],
  ["SP", v("a b")],
  ["E", v("")],
  ["G", v("*.ts")],
]);

/** `src` read as one word and expanded with `vars`. */
function read(
  src: string,
  vars: Vars = VARS,
  { split = true }: { split?: boolean } = {},
): ReturnType<typeof expandWord> {
  return expandWord(wordAt(src, 0).word, vars, { split });
}

describe("expandWord", () => {
  it("takes the value of $NAME and ${NAME} the line set", () => {
    expect(read('a"$X"b${X}c$X')).toMatchObject({ literal: true, pieces: ["axbxcx"], text: "axbxcx" });
  });

  it("keeps an unquoted value unknown when bash would split or glob it, and a quoted one known", () => {
    expect(read("$SP").literal).toBe(false);
    expect(read('"$SP"').text).toBe("a b");
    expect(read("$E").literal).toBe(false);
    expect(read('"$E"')).toMatchObject({ literal: true, text: "" });
    expect(read("$G").literal).toBe(false);
    expect(read("$SP", VARS, { split: false })).toMatchObject({ literal: true, text: "a b" });
  });

  it("splits by the IFS the line set, and keeps every unquoted value unknown when IFS is unknown", () => {
    const comma = new Map([...VARS, ["IFS", v(",")]]);

    expect(read("$SP", comma).text).toBe("a b");
    expect(read("$X", new Map([["X", v("x")]])).literal).toBe(false);
    expect(read('"$X"', new Map([["X", v("x")]])).text).toBe("x");
  });
});

describe("expandWord: what stays unknown, and the path spellings", () => {
  it("keeps every other expansion unknown, a substitution empty in the path spellings", () => {
    expect(read("${X:-d}").literal).toBe(false);
    expect(read("$1").literal).toBe(false);
    expect(read("$NOPE").literal).toBe(false);
    expect(read("a$(cmd)b")).toMatchObject({
      literal: false,
      pathBash: "ab",
      pathText: "ab",
      pieces: ["a", "b"],
      text: "a$(cmd)b",
    });
    expect(read("a${Q}b${R}c")).toMatchObject({ pathText: "a${Q}b${R}c", pieces: ["a", "b", "c"] });
  });

  it("keeps a backslash in the path text and drops it in the bash text", () => {
    expect(read(String.raw`a\b`)).toMatchObject({ pathBash: "ab", pathText: String.raw`a\b`, text: "ab" });
  });
});

describe("expandWord: tilde", () => {
  it("reads a leading ~ as the home and ~+ as the dir, other tilde forms as unknown", () => {
    expect(read("~").text).toBe("/h");
    expect(read("~/x").text).toBe("/h/x");
    expect(read("~+/x").text).toBe("/r/x");
    expect(read("~bob/x")).toMatchObject({ literal: false, pieces: ["", "/x"] });
    expect(read("~", new Map()).literal).toBe(false);
    expect(read('"~"/x').text).toBe("~/x");
    expect(read("a~").text).toBe("a~");
    expect(read("~x~").literal).toBe(false);
    expect(read('~"root"/x')).toMatchObject({ literal: true, text: "~root/x" });
    expect(read("~$X/y")).toMatchObject({ literal: true, text: "~x/y" });
    expect(read(String.raw`~x\y`)).toMatchObject({ literal: true, text: "~xy" });
  });
});

describe("lookup and valueOf", () => {
  it("names an unset variable as its cause", () => {
    expect(lookup(VARS, "X")).toStrictEqual(v("x"));
    expect(lookup(VARS, "NOPE")).toStrictEqual({ cause: "$NOPE", known: false });
  });

  it("gives a word's value, or the word as typed when a part is unknown", () => {
    expect(valueOf(read("$X/y"))).toStrictEqual(v("x/y"));
    expect(valueOf(read("$Q/y"))).toStrictEqual({ cause: "$Q/y", known: false });
  });
});
