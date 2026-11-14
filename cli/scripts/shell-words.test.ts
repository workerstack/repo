import { expect, it } from "vitest";

import { holdsCommand, simpleCommands } from "./shell-words.ts";

/** The words of each simple command of `cmd`. */
function wordsOf(cmd: string): string[][] {
  return simpleCommands(cmd).map((command) => command.words);
}

/** The bash reading of each word of each simple command of `cmd`. */
function bashOf(cmd: string): string[][] {
  return simpleCommands(cmd).map((command) => command.bashWords);
}

/** The indices of the words with an expansion, per simple command of `cmd`. */
function expandedOf(cmd: string): number[][] {
  return simpleCommands(cmd).map((command) => [...command.expanded]);
}

it("simpleCommands: marks each word a redirect reads or writes, and no other", () => {
  const words = ["grep", "a", "x", "b", "2", "1", "c"];

  expect(simpleCommands("grep < a x >b 2>&1 >>c; cat d")).toStrictEqual([
    { bashWords: words, expanded: new Set(), redirects: new Set([1, 3, 5, 6]), words },
    { bashWords: ["cat", "d"], expanded: new Set(), redirects: new Set(), words: ["cat", "d"] },
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

it("simpleCommands: reads each word as bash does too, which drops every backslash outside quotes", () => {
  expect(bashOf("cat bun\\.lock C:\\r\\x a\\ b a\\")).toStrictEqual([["cat", "bun.lock", "C:rx", "a b", "a\\"]]);
  expect(bashOf("cat 'bun\\.lock' \"bun\\.lock\"")).toStrictEqual([["cat", "bun\\.lock", "bun\\.lock"]]);
});

it("simpleCommands: decodes an ANSI-C quote in both readings", () => {
  const cmd = "echo $'\\x64\\u0069\\U00000073\\164\\cA\\n\\'\\q\\U7fffffff' $'open";

  expect(wordsOf(cmd)).toStrictEqual([["echo", "dist\u0001\n'\\q\\U7fffffff", "open"]]);
  expect(bashOf(cmd)).toStrictEqual(wordsOf(cmd));
  expect(expandedOf(cmd)).toStrictEqual([[]]);
});

it("simpleCommands: marks the words that hold an expansion, and no single-quoted or bare dollar", () => {
  const cmd = ["a", "$b", '"$c"', "${d}", "$1", "$?", "x$(y)", "z`w`", "'$e'", "$", '"$"', '$"f"'].join(" ");

  expect(expandedOf(cmd)).toStrictEqual([[], [], [1, 2, 3, 4, 5, 6, 7]]);
  expect(wordsOf('echo $"a b"')).toStrictEqual([["echo", "a b"]]);
});

it("simpleCommands: splits simple commands at each control operator", () => {
  const each = [["a"], ["b"], ["c"], ["d"], ["e"], ["f"], ["g"]];
  expect(wordsOf("a | b || c && d & e ; f\ng")).toStrictEqual(each);
  expect(wordsOf("a|b;c")).toStrictEqual([["a"], ["b"], ["c"]]);
});

it("simpleCommands: splits at a subshell and reads a substitution as commands of its own", () => {
  expect(wordsOf("(a x) $(b y) `c z`")).toStrictEqual([
    ["a", "x"],
    ["b", "y"],
    ["c", "z"],
    ["", ""],
  ]);
  expect(wordsOf("echo $HOME")).toStrictEqual([["echo", "$HOME"]]);
});

it("simpleCommands: keeps the words around a substitution in the command that holds it", () => {
  expect(wordsOf("rg a $(b c) d")).toStrictEqual([
    ["b", "c"],
    ["rg", "a", "", "d"],
  ]);
  expect(wordsOf("rg a x$(b $(c) ')' \\) \"(\" `d`)y d")).toStrictEqual([
    ["c"],
    ["d"],
    ["b", "", ")", ")", "(", ""],
    ["rg", "a", "xy", "d"],
  ]);
  expect(wordsOf('rg a "$(b) `c \\`d\\``" e')).toStrictEqual([["b"], ["d"], ["c", ""], ["rg", "a", " ", "e"]]);
  expect(wordsOf("echo $((1 + 2)) x")).toStrictEqual([
    ["1", "+", "2"],
    ["echo", "", "x"],
  ]);
});

it("simpleCommands: reads an unclosed substitution to the end", () => {
  expect(wordsOf("rg a $(b c")).toStrictEqual([
    ["b", "c"],
    ["rg", "a", ""],
  ]);
  expect(wordsOf("rg a `b 'c")).toStrictEqual([
    ["b", "c"],
    ["rg", "a", ""],
  ]);
  expect(wordsOf('rg a $(b "c')).toStrictEqual([
    ["b", "c"],
    ["rg", "a", ""],
  ]);
  expect(wordsOf("rg a $(b 'c")).toStrictEqual([
    ["b", "c"],
    ["rg", "a", ""],
  ]);
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
