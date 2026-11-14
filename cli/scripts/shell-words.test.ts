import { expect, it } from "vitest";

import { holdsCommand, simpleCommands } from "./shell-words.ts";

/** The words of each simple command of `cmd`. */
function wordsOf(cmd: string): string[][] {
  return simpleCommands(cmd).map((command) => command.words);
}

it("simpleCommands: marks each word a redirect reads or writes, and no other", () => {
  expect(simpleCommands("grep < a x >b 2>&1 >>c; cat d")).toStrictEqual([
    { redirects: new Set([1, 3, 5, 6]), words: ["grep", "a", "x", "b", "2", "1", "c"] },
    { redirects: new Set(), words: ["cat", "d"] },
  ]);
});

it("simpleCommands: splits words at blanks and reads nothing from an empty command", () => {
  expect(wordsOf("a  b\tc")).toStrictEqual([["a", "b", "c"]]);
  expect(wordsOf("   ")).toStrictEqual([]);
});

it("simpleCommands: keeps a single-quoted span as one literal word", () => {
  expect(wordsOf("grep -E 'a|b' x")).toStrictEqual([["grep", "-E", "a|b", "x"]]);
  expect(wordsOf("echo 'a \\\" $(b)'")).toStrictEqual([["echo", 'a \\" $(b)']]);
});

it("simpleCommands: strips double quotes and honors their escapes", () => {
  expect(wordsOf('head "dist"')).toStrictEqual([["head", "dist"]]);
  expect(wordsOf('echo "a \\"b\\" \\$c \\\\d \\x"')).toStrictEqual([["echo", 'a "b" $c \\d \\x']]);
  expect(wordsOf('echo ""')).toStrictEqual([["echo", ""]]);
});

it("simpleCommands: joins quoted and bare spans that touch into one word", () => {
  expect(wordsOf("a\"b\"'c'd")).toStrictEqual([["abcd"]]);
});

it("simpleCommands: removes a backslash before a shell character and keeps one before any other", () => {
  expect(wordsOf("cat a\\ b \\| \\'q")).toStrictEqual([["cat", "a b", "|", "'q"]]);
  expect(wordsOf("cat C:\\r\\node\\x")).toStrictEqual([["cat", "C:\\r\\node\\x"]]);
  expect(wordsOf("cat a\\")).toStrictEqual([["cat", "a\\"]]);
});

it("simpleCommands: splits simple commands at each control operator", () => {
  const each = [["a"], ["b"], ["c"], ["d"], ["e"], ["f"], ["g"]];
  expect(wordsOf("a | b || c && d & e ; f\ng")).toStrictEqual(each);
  expect(wordsOf("a|b;c")).toStrictEqual([["a"], ["b"], ["c"]]);
});

it("simpleCommands: splits at a subshell, a command substitution and backticks", () => {
  const each = [
    ["a", "x"],
    ["b", "y"],
    ["c", "z"],
  ];

  expect(wordsOf("(a x) $(b y) `c z`")).toStrictEqual(each);
  expect(wordsOf("echo $HOME")).toStrictEqual([["echo", "$HOME"]]);
});

it("simpleCommands: splits words at redirects and keeps 2>&1 and &> inside one command", () => {
  expect(wordsOf("cat <in >out")).toStrictEqual([["cat", "in", "out"]]);
  expect(wordsOf("x 2>&1 | y")).toStrictEqual([["x", "2", "1"], ["y"]]);
  expect(wordsOf("x &> log")).toStrictEqual([["x", "log"]]);
  expect(wordsOf("x >&log")).toStrictEqual([["x", "log"]]);
});

it("simpleCommands: reads an unclosed quote to the end as one word", () => {
  expect(wordsOf("cat 'dist")).toStrictEqual([["cat", "dist"]]);
  expect(wordsOf('cat "a | b')).toStrictEqual([["cat", "a | b"]]);
});

it("holdsCommand: is true for a word with a blank or a shell operator", () => {
  for (const word of ["cat x", "a|b", "a;b", "$(a)", "`a`", "a>b", "a&b"]) expect(holdsCommand(word), word).toBe(true);

  for (const word of ["dist/x", "$HOME", "-n", "{}"]) expect(holdsCommand(word), word).toBe(false);
});
