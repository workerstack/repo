import os from "node:os";

import { describe, expect, it } from "vitest";

import type { Simple, Value, Vars } from "./shell-ast.types.ts";
import { wordAt } from "./shell-lex-word.ts";
import { assignment, joinVars, processEnv, sameVars, seedVars, varsAfter, withDir, withVar } from "./shell-vars.ts";

const START = seedVars({ cdpath: "", home: "/h" }, "/r");

function v(text: string): Value {
  return { known: true, text };
}

/** A simple command of words split on blanks. */
function simple(src: string): Simple {
  return { kind: "simple", redirects: [], words: src.split(" ").map((w) => wordAt(w, 0).word) };
}

/** `name` after `src` ran with `vars`: its text, `?cause`, or `-` when it is not held. */
function after(src: string, name: string, vars: Vars = START): string {
  const got = varsAfter(simple(src), vars).get(name);

  if (got === undefined) return "-";

  return got.known ? got.text : `?${got.cause}`;
}

describe("seedVars and processEnv", () => {
  it("starts with the home, the cd path, the dir and bash's IFS", () => {
    expect([...START]).toStrictEqual([
      ["HOME", v("/h")],
      ["CDPATH", v("")],
      ["PWD", v("/r")],
      ["IFS", v(" \t\n")],
    ]);
  });

  it("reads this process's home", () => {
    expect(processEnv().home).toBe(os.homedir());
  });
});

describe("varsAfter", () => {
  it("sets the variables of a line of assignments, left to right", () => {
    expect(after("A=/x B=$A/y", "B")).toBe("/x/y");
    expect(after("A=x A+=y", "A")).toBe("xy");
    expect(after("A+=y", "A")).toBe("?y");
    expect(after("A=~/x", "A")).toBe("/h/x");
    expect(after("A=a:~/x", "A")).toBe("?a:~/x");
    expect(after("A=$(pwd)", "A")).toBe("?$(pwd)");
    expect(after("A=$Q", "A")).toBe("?$Q");
    expect(after("A[0]=x", "A", withVar(START, "A", v("y")))).toBe("?x");
  });

  it("sets what export and readonly name, and leaves a prefix to its program", () => {
    expect(after("export A=x B", "A")).toBe("x");
    expect(after("readonly A=x", "A")).toBe("x");
    expect(after("A=x git status", "A")).toBe("-");
    expect(after("/usr/bin/env A=x", "A")).toBe("-");
  });

  it("forgets every variable after a builtin it does not follow, an unknown program or an assigning expansion", () => {
    for (const src of ["read A", "eval A=y", "trap A=y EXIT", "source f", "printf -v A x", "$P x"])
      expect(after(src, "HOME"), src).toBe("-");

    for (const src of ["echo ${A=y}", "echo ${A:=y}", "echo $((A=1))", "echo $((A++))"])
      expect(after(src, "HOME"), src).toBe("-");
    expect(after("echo $((A==1)) ${A:-y}", "HOME")).toBe("/h");
    expect(after("printf %s x", "HOME")).toBe("/h");
  });
});

describe("varsAfter: unset", () => {
  const held = withVar(withVar(START, "A", v("a")), "B", v("b"));

  it("drops only the variables it names, a subscript dropping its array", () => {
    expect(["A", "B", "HOME"].map((n) => after("unset A B", n, held))).toStrictEqual(["-", "-", "/h"]);
    expect(["A", "B"].map((n) => after("unset -v -- A", n, held))).toStrictEqual(["-", "b"]);
    expect(["A", "B"].map((n) => after("unset A[0]", n, held))).toStrictEqual(["-", "b"]);
    expect(after("unset", "A", held)).toBe("a");
  });

  it("keeps every variable when it drops only functions", () => {
    expect(after("unset -f A", "A", held)).toBe("a");
  });

  it("forgets every variable after a name reference, an unknown option or a name it cannot read", () => {
    for (const src of ["unset -n A", "unset -x A", "unset $N", "unset -fn A"])
      expect(after(src, "B", held), src).toBe("-");
  });
});

describe("assignment", () => {
  it("reads the name and value of an assignment word, or null for another word", () => {
    expect(assignment(wordAt("A=x", 0).word, START)).toStrictEqual({ name: "A", value: v("x") });
    expect(assignment(wordAt("echo", 0).word, START)).toBeNull();
  });
});

describe("joining and comparing", () => {
  const a = withVar(START, "A", v("x"));

  it("keeps a value both branches agree on, and loses the rest", () => {
    const joined = joinVars(a, withVar(START, "B", v("y")));

    expect(joined.get("HOME")).toStrictEqual(v("/h"));
    expect(joined.get("A")).toStrictEqual({ cause: "a variable set in a branch", known: false });
    expect(joined.get("B")).toStrictEqual({ cause: "a variable set in a branch", known: false });
  });

  it("tells when both hold the same known values", () => {
    expect(sameVars(a, withVar(START, "A", v("x")))).toBe(true);
    expect(sameVars(a, START)).toBe(false);
    expect(sameVars(a, withVar(START, "A", v("y")))).toBe(false);
    expect(sameVars(withVar(START, "A", { cause: "c", known: false }), withVar(START, "A", v("x")))).toBe(false);
  });

  it("sets PWD from a dir, unknown with its cause", () => {
    expect(withDir(START, { known: true, path: "/d" }).get("PWD")).toStrictEqual(v("/d"));
    expect(withDir(START, { cause: "$D", known: false }).get("PWD")).toStrictEqual({ cause: "$D", known: false });
  });
});
