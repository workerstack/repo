import { expect, it } from "vitest";

import { commandAt } from "./command-at.ts";
import { lex } from "./shell-lex.ts";
import { shellParse } from "./shell-parse.ts";

/** The word `src` runs as its program, or "" when it runs none. */
function program(src: string): string {
  const node = shellParse(lex(src));

  if (node.kind !== "simple") throw new Error(`not a simple command: ${src}`);

  return node.words[commandAt(node.words)]?.raw ?? "";
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
