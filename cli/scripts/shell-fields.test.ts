import path from "node:path";

import { describe, expect, it } from "vitest";

import { fileTree } from "./__fixtures__/file-tree.ts";
import type { Dir, Scope, Simple, Value } from "./shell-ast.types.ts";
import { expandCommand, readWord, valueOf } from "./shell-fields.ts";
import { scriptText } from "./shell-lex-word.ts";
import { lex } from "./shell-lex.ts";
import { shellParse } from "./shell-parse.ts";

function v(text: string): Value {
  return { known: true, text };
}

/** A temp dir holding `a.ts` and `b.ts`, removed after the test. */
function tsDir(): Dir {
  return { known: true, path: fileTree(["a.ts", "b.ts"]) };
}

function scope(dir: Dir = { known: true, path: "/no-such-fields-dir" }): Scope {
  return {
    dir,
    vars: new Map([
      ["IFS", v(" ")],
      ["Y", v("a b")],
      ["G", v("*.ts")],
      ["E", v("")],
    ]),
  };
}

/** The simple command `src` parses to. */
function simple(src: string): Simple {
  const node = shellParse(lex(src));

  if (node.kind !== "simple") throw new Error(`not a simple command: ${src}`);

  return node;
}

/** The command `c` as bash runs it in `at`: its words as typed text, then `>` and each redirect target. */
function runSimple(c: Simple, at: Scope = scope()): string[] | null {
  const got = expandCommand(c, at, path);

  return got === null
    ? null
    : [...got.words.map(scriptText), ...got.redirects.map((r) => `${r.op}${scriptText(r.target)}`)];
}

/** The command `src` parses to, as `runSimple` gives it. */
function run(src: string, at: Scope = scope()): string[] | null {
  return runSimple(simple(src), at);
}

/** The first word of `src` after expansion in `at`, read. */
function read(src: string, at: Scope = scope()): ReturnType<typeof readWord> {
  const field = expandCommand(simple(`: ${src}`), at, path)?.words[1];

  if (field === undefined) throw new Error(`no field for ${src}`);

  return readWord(field);
}

describe("expandCommand", () => {
  it("makes the fields of each word, and keeps an assignment before the program as typed", () => {
    expect(run("X=$Y cmd $Y {p,q}")).toStrictEqual(["X=$Y", "cmd", "a", "b", "p", "q"]);
  });

  it("keeps an assignment word after export or readonly as typed, and expands every other word", () => {
    expect(run("export A=$Y $Y")).toStrictEqual(["export", "A=$Y", "a", "b"]);
    expect(run("readonly A={p,q}")).toStrictEqual(["readonly", "A={p,q}"]);
    expect(run("echo A=$Y")).toStrictEqual(["echo", "A=a", "b"]);
    expect(run("$Q export A=$Y")).toStrictEqual(["$Q", "export", "A=a", "b"]);
    expect(run("$E export A=$Y")).toStrictEqual(["export", "A=a", "b"]);
  });

  it("reads each word as one value for a data command", () => {
    expect(runSimple({ ...simple("$Y {p,q}"), data: "value" })).toStrictEqual(["a b", "{p,q}"]);
    expect(runSimple({ ...simple("$Y {p,q}"), data: "fields" })).toStrictEqual(["a", "b", "p", "q"]);
  });

  it("gives a redirect per field of its file, and keeps a heredoc word or a here-string as typed", () => {
    expect(run("cat > {p,q} <<< $Y")).toStrictEqual(["cat", ">p", ">q", "<<<$Y"]);
  });

  it("gives null when braces in a word or a redirect make more words than the gate reads", () => {
    expect(run("echo {1..2000}")).toBeNull();
    expect(run("echo > {1..2000}")).toBeNull();
  });

  it("matches a glob from the dir, leaves one that matches nothing as typed, and keeps one it cannot read", () => {
    const dir = tsDir();

    expect(run("cat *.ts $G", scope(dir))).toStrictEqual(["cat", "a.ts", "b.ts", "a.ts", "b.ts"]);
    expect(run("cat z*", scope(dir))).toStrictEqual(["cat", "z*"]);
    expect(run("cat *.ts", scope({ cause: "x", known: false }))).toStrictEqual(["cat", "*.ts"]);
    expect(run("cat $Q*", scope(dir))).toStrictEqual(["cat", "$Q*"]);
  });
});

describe("readWord", () => {
  it("reads literal text as known, and keeps a backslash in the path text and drops it in the bash text", () => {
    expect(read(String.raw`a\b`)).toMatchObject({
      glob: null,
      literal: true,
      pathBash: "ab",
      pathText: String.raw`a\b`,
    });
  });

  it("keeps an expansion unknown as typed, and a substitution empty in the path spellings", () => {
    expect(read("a$(cmd)b")).toMatchObject({
      literal: false,
      pathBash: "ab",
      pathText: "ab",
      pieces: ["a", "b"],
      text: "a$(cmd)b",
    });
    expect(read("a${Q}b${R}c")).toMatchObject({ pathText: "a${Q}b${R}c", pieces: ["a", "b", "c"] });
  });

  it("reads a glob it cannot match as unknown, with the pattern its words spell", () => {
    expect(read("$Q/'*'*")).toMatchObject({
      glob: String.raw`$Q/\**`,
      literal: false,
      pathText: "$Q/**",
      pieces: ["", "/*", ""],
      text: "$Q/**",
    });
  });
});

describe("valueOf", () => {
  it("gives a field's value, or the word as typed when a part is unknown", () => {
    expect(valueOf(read("$Y/x"))).toStrictEqual(v("a"));
    expect(valueOf(read('"$Y"/x'))).toStrictEqual(v("a b/x"));
    expect(valueOf(read("$Q/y"))).toStrictEqual({ cause: "$Q/y", known: false });
  });
});
