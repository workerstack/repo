import path from "node:path";

import { expect, it } from "vitest";

import { commandAt, runDir } from "./command-at.ts";
import type { Dir, ShellWord } from "./shell-ast.types.ts";
import { lex } from "./shell-lex.ts";
import { shellParse } from "./shell-parse.ts";

/** The words of the simple command `src`. */
function wordsOf(src: string): readonly ShellWord[] {
  const node = shellParse(lex(src));

  if (node.kind !== "simple") throw new Error(`not a simple command: ${src}`);

  return node.words;
}

/** The word `src` runs as its program, or "" when it runs none. */
function program(src: string): string {
  const words = wordsOf(src);

  return words[commandAt(words)]?.raw ?? "";
}

/** The dir the program of `src` runs in from `/r`, with `p`. */
function dirOf(src: string, p: typeof path = path.posix): Dir {
  return runDir(wordsOf(src), { known: true, path: p === path.posix ? "/r" : "C:\\r" }, p);
}

function at(dir: string): Dir {
  return { known: true, path: dir };
}

it("commandAt: finds the program past assignments and runners, their options, values and operands", () => {
  expect(program("A=1 git status")).toBe("git");
  expect(program("sudo -u bob -E git push")).toBe("git");
  expect(program("timeout -k 1 5s rtk git log")).toBe("git");
  expect(program("env -- A=1 git")).toBe("git");
  expect(program("xargs -I {} git show {}")).toBe("git");
});

it("commandAt: stops at the first program that is no runner, and at the end", () => {
  expect(program("env A=1 echo git stash")).toBe("echo");
  expect(program("$G push")).toBe("$G");
  expect(program("sudo")).toBe("");
  expect(program("A=1")).toBe("");
});

it("runDir: moves to the dir each runner's dir option names, in every spelling, in order", () => {
  expect(dirOf("env -C /a git push")).toStrictEqual(at("/a"));
  expect(dirOf("env -Ca git push")).toStrictEqual(at("/r/a"));
  expect(dirOf("env --chdir a git push")).toStrictEqual(at("/r/a"));
  expect(dirOf("env --chdir='/a b' git push")).toStrictEqual(at("/a b"));
  expect(dirOf("sudo -D /a -u bob env -C b git")).toStrictEqual(at("/a/b"));
  expect(dirOf("sudo --chdir=/a git")).toStrictEqual(at("/a"));
  expect(dirOf("env -C a git push", path.win32)).toStrictEqual(at("C:\\r\\a"));
});

it("runDir: keeps the dir with no dir option, and loses it to one the gate cannot read", () => {
  expect(dirOf("env -u A git push")).toStrictEqual(at("/r"));
  expect(dirOf("sudo -C 3 git push")).toStrictEqual(at("/r"));
  expect(dirOf("env -- -C /a")).toStrictEqual(at("/r"));
  expect(dirOf("env -C")).toStrictEqual(at("/r"));
  expect(dirOf('env -C "$D" git')).toStrictEqual({ cause: '"$D"', known: false });
  expect(dirOf("env --chdir=~/a git")).toStrictEqual({ cause: "~/a", known: false });
});
