import path from "node:path";

import { describe, expect, it } from "vitest";

import { cdEffect } from "./cd-effect.ts";
import type { Dir } from "./shell-ast.types.ts";
import { wordAt } from "./shell-lex-word.ts";

const HERE: Dir = { known: true, path: "/r" };
const LOST: Dir = { cause: '"$D"', known: false };

/** The dir after the command `src` run from `dir`, as a path, `?cause`, or null when it changes none. */
function after(src: string, dir: Dir = HERE): string | null {
  const words = src.split(" ").map((w) => wordAt(w, 0).word);
  const got = cdEffect(words, dir, path.posix);

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
    expect(after("cd ~/x")).toBe("?~/x");
    expect(after("pushd +1")).toBe("?+1");
    expect(after("cd -")).toBe("?the folder of cd -");
    expect(after("cd")).toBe("?the home folder");
    expect(after("pushd")).toBe("?the folder of pushd");
    expect(after("popd")).toBe("?the folder of popd");
    expect(after("cd a b")).toBe("?a b");
  });

  it("changes nothing for another command or an expanded program", () => {
    expect(after("ls a")).toBeNull();
    expect(after("$CD a")).toBeNull();
    expect(after("x=1")).toBeNull();
  });
});
