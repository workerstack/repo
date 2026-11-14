import { describe, expect, it } from "vitest";

import type { Value, Vars } from "./shell-ast.types.ts";
import { expandFields, expandValue, lookup } from "./shell-expand.ts";
import { readWord } from "./shell-fields.ts";
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
  ["SP", v(" a  b ")],
  ["E", v("")],
  ["G", v("*.ts")],
]);

/** A field as text, `?raw` when a part is unknown, or `glob:pattern` when it holds a pattern bash matches on disk. */
function shown(field: Parameters<typeof readWord>[0]): string {
  const r = readWord(field);

  if (r.glob !== null) return `glob:${r.glob}`;

  return r.literal ? r.text : `?${r.raw}`;
}

/** The fields bash makes of the word `src` with `vars`; null over the brace cap. */
function fields(src: string, vars: Vars = VARS): string[] | null {
  return expandFields(wordAt(src, 0).word, vars)?.map(shown) ?? null;
}

/** `src` read as one value with `vars`. */
function value(src: string, vars: Vars = VARS): string {
  return shown(expandValue(wordAt(src, 0).word, vars));
}

describe("expandFields: parameters and splitting", () => {
  it("takes the value of $NAME and ${NAME} the line set", () => {
    expect(fields('a"$X"b${X}c$X')).toStrictEqual(["axbxcx"]);
  });

  it("splits an unquoted value at IFS blanks, which collapse and trim, and keeps a quoted one whole", () => {
    expect(fields("$SP")).toStrictEqual(["a", "b"]);
    expect(fields("x$SP-y")).toStrictEqual(["x", "a", "b", "-y"]);
    expect(fields('"$SP"')).toStrictEqual([" a  b "]);
  });

  it("drops an unquoted empty value and keeps a quoted one as an empty field", () => {
    expect(fields("$E")).toStrictEqual([]);
    expect(fields('"$E"')).toStrictEqual([""]);
    expect(fields("''$E")).toStrictEqual([""]);
    expect(fields("x$E")).toStrictEqual(["x"]);
  });
});

describe("expandFields: IFS", () => {
  it("ends a field at each other IFS character, even an empty one, but not at the end", () => {
    const comma = new Map([...VARS, ["IFS", v(", ")], ["A", v(",a,,b , c,")]]);

    expect(fields("$A", comma)).toStrictEqual(["", "a", "", "b", "c"]);
    expect(fields("$SP", comma)).toStrictEqual(["a", "b"]);
    expect(fields("$X", new Map([...comma, ["X", v("p,")]]))).toStrictEqual(["p"]);
  });

  it("keeps an unquoted value unknown when IFS is unknown, and splits nothing when it is empty", () => {
    expect(fields("$X", new Map([["X", v("x")]]))).toStrictEqual(["?$X"]);
    expect(fields('"$X"', new Map([["X", v("x")]]))).toStrictEqual(["x"]);
    expect(fields("$SP", new Map([...VARS, ["IFS", v("")]]))).toStrictEqual([" a  b "]);
  });

  it("leaves a pattern in an unquoted value active, and one in a quoted value inert", () => {
    expect(fields("$G")).toStrictEqual(["glob:*.ts"]);
    expect(fields('"$G"')).toStrictEqual(["*.ts"]);
  });

  it("keeps every other expansion unknown", () => {
    for (const src of ["${X:-d}", "$1", "$NOPE", "$(cmd)"]) expect(fields(src), src).toStrictEqual([`?${src}`]);
  });
});

describe("expandFields: braces", () => {
  it("expands braces before parameters, each word split on its own", () => {
    expect(fields("{a,b}$X")).toStrictEqual(["ax", "bx"]);
    expect(fields("{a,b}$SP")).toStrictEqual(["a", "a", "b", "b", "a", "b"]);
  });

  it("gives null when the braces make more words than the gate reads", () => {
    expect(fields("{1..2000}")).toBeNull();
  });
});

describe("expandFields: tilde", () => {
  it("reads a leading ~ as the home and ~+ as the dir, other tilde forms as unknown", () => {
    expect(fields("~")).toStrictEqual(["/h"]);
    expect(fields("~/x")).toStrictEqual(["/h/x"]);
    expect(fields("~+/x")).toStrictEqual(["/r/x"]);
    expect(fields("~bob/x")).toStrictEqual(["?~bob/x"]);
    expect(fields("~", new Map())).toStrictEqual(["?~"]);
    expect(fields('"~"/x')).toStrictEqual(["~/x"]);
    expect(fields("a~")).toStrictEqual(["a~"]);
    expect(fields("~x~")).toStrictEqual(["?~x~"]);
    expect(fields('~"root"/x')).toStrictEqual(["~root/x"]);
    expect(fields("~$X/y")).toStrictEqual(["~x/y"]);
    expect(fields(String.raw`~x\y`)).toStrictEqual(["~xy"]);
  });

  it("does not split or glob the home", () => {
    expect(fields("~/x", new Map([...VARS, ["HOME", v("/a b/*")]]))).toStrictEqual(["/a b/*/x"]);
  });
});

describe("expandValue", () => {
  it("reads one value: no braces, no splitting, no field dropped", () => {
    expect(value("{a,b}$SP")).toStrictEqual("{a,b} a  b ");
    expect(value("$E")).toStrictEqual("");
    expect(value("~/x")).toStrictEqual("/h/x");
    expect(value("$Q")).toStrictEqual("?$Q");
  });
});

describe("lookup", () => {
  it("names an unset variable as its cause", () => {
    expect(lookup(VARS, "X")).toStrictEqual(v("x"));
    expect(lookup(VARS, "NOPE")).toStrictEqual({ cause: "$NOPE", known: false });
  });
});
