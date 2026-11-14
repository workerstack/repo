import path from "node:path";

import { describe, expect, it } from "vitest";

import { cdEffect } from "./cd-effect.ts";
import type { Dir, Vars } from "./shell-ast.types.ts";
import { wordAt } from "./shell-lex-word.ts";
import { seedVars, withVar } from "./shell-vars.ts";

const HERE: Dir = { known: true, path: "/r" };
const LOST: Dir = { cause: '"$D"', known: false };
const START = seedVars({ cdpath: "", home: "/h" }, "/r");

/** The dir after the command `src` run from `dir` with `vars`, as a path, `?cause`, or null when it changes none. */
function after(src: string, dir: Dir = HERE, vars: Vars = START): string | null {
  const words = src.split(" ").map((w) => wordAt(w, 0).word);
  const got = cdEffect(words, { dir, vars }, path.posix);

  if (got === null) return null;

  return got.known ? got.path : `?${got.cause}`;
}

describe("cdEffect", () => {
  it("resolves one literal dir, past options and --", () => {
    expect(after("cd a")).toBe("/r/a");
    expect(after("cd -P -L -- ../b")).toBe("/b");
    expect(after("x=1 pushd /abs")).toBe("/abs");
  });

  it("finds an absolute dir from an unknown one, and keeps a relative one unknown", () => {
    expect(after("cd /abs", LOST)).toBe("/abs");
    expect(after("cd a", LOST)).toBe('?"$D"');
  });

  it("loses the dir for any other form, naming why", () => {
    expect(after('cd "$D"')).toBe('?"$D"');
    expect(after("cd ~bob/x")).toBe("?~bob/x");
    expect(after("pushd +1")).toBe("?+1");
    expect(after("cd -")).toBe("?the folder of cd -");
    expect(after("cd", HERE, new Map())).toBe("?the home folder");
    expect(after("cd", HERE, withVar(START, "HOME", { known: true, text: "h" }))).toBe("?the home folder");
    expect(after("pushd")).toBe("?the folder of pushd");
    expect(after("popd")).toBe("?the folder of popd");
    expect(after("cd a b")).toBe("?a b");
  });
});

describe("cdEffect with the variables of the line", () => {
  it("reads the home and the variables the line set", () => {
    expect(after("cd")).toBe("/h");
    expect(after("cd ~/x")).toBe("/h/x");
    expect(after("cd $D/x", HERE, withVar(START, "D", { known: true, text: "/d" }))).toBe("/d/x");
    expect(after("$C a", HERE, withVar(START, "C", { known: true, text: "cd" }))).toBe("/r/a");
  });

  it("loses a relative dir that a set or unknown CDPATH may find elsewhere", () => {
    const set = withVar(START, "CDPATH", { known: true, text: "/x" });

    expect(after("cd a", HERE, set)).toBe("?a in CDPATH");
    expect(after("cd a", HERE, new Map())).toBe("?a in CDPATH");
    expect(after("cd ./a", HERE, set)).toBe("/r/a");
    expect(after("cd ..", HERE, set)).toBe("/");
    expect(after("cd /abs", HERE, set)).toBe("/abs");
  });

  it("changes nothing for another command or an expanded program", () => {
    expect(after("ls a")).toBeNull();
    expect(after("$CD a")).toBeNull();
    expect(after("x=1")).toBeNull();
  });
});
