import { expect, it } from "vitest";

import { holdsCommand, simpleCommands } from "./shell-words.ts";

it("simpleCommands: splits words at blanks and reads nothing from an empty command", () => {
  expect(simpleCommands("a  b\tc")).toStrictEqual([["a", "b", "c"]]);
  expect(simpleCommands("   ")).toStrictEqual([]);
});

it("simpleCommands: keeps a single-quoted span as one literal word", () => {
  expect(simpleCommands("grep -E 'a|b' x")).toStrictEqual([["grep", "-E", "a|b", "x"]]);
  expect(simpleCommands("echo 'a \\\" $(b)'")).toStrictEqual([["echo", 'a \\" $(b)']]);
});

it("simpleCommands: strips double quotes and honors their escapes", () => {
  expect(simpleCommands('head "dist"')).toStrictEqual([["head", "dist"]]);
  expect(simpleCommands('echo "a \\"b\\" \\$c \\\\d \\x"')).toStrictEqual([["echo", 'a "b" $c \\d \\x']]);
  expect(simpleCommands('echo ""')).toStrictEqual([["echo", ""]]);
});

it("simpleCommands: joins quoted and bare spans that touch into one word", () => {
  expect(simpleCommands("a\"b\"'c'd")).toStrictEqual([["abcd"]]);
});

it("simpleCommands: removes a backslash before a shell character and keeps one before any other", () => {
  expect(simpleCommands("cat a\\ b \\| \\'q")).toStrictEqual([["cat", "a b", "|", "'q"]]);
  expect(simpleCommands("cat C:\\r\\node\\x")).toStrictEqual([["cat", "C:\\r\\node\\x"]]);
  expect(simpleCommands("cat a\\")).toStrictEqual([["cat", "a\\"]]);
});

it("simpleCommands: splits simple commands at each control operator", () => {
  const each = [["a"], ["b"], ["c"], ["d"], ["e"], ["f"], ["g"]];
  expect(simpleCommands("a | b || c && d & e ; f\ng")).toStrictEqual(each);
  expect(simpleCommands("a|b;c")).toStrictEqual([["a"], ["b"], ["c"]]);
});

it("simpleCommands: splits at a subshell, a command substitution and backticks", () => {
  const each = [
    ["a", "x"],
    ["b", "y"],
    ["c", "z"],
  ];

  expect(simpleCommands("(a x) $(b y) `c z`")).toStrictEqual(each);
  expect(simpleCommands("echo $HOME")).toStrictEqual([["echo", "$HOME"]]);
});

it("simpleCommands: splits words at redirects and keeps 2>&1 and &> inside one command", () => {
  expect(simpleCommands("cat <in >out")).toStrictEqual([["cat", "in", "out"]]);
  expect(simpleCommands("x 2>&1 | y")).toStrictEqual([["x", "2", "1"], ["y"]]);
  expect(simpleCommands("x &> log")).toStrictEqual([["x", "log"]]);
  expect(simpleCommands("x >&log")).toStrictEqual([["x", "log"]]);
});

it("simpleCommands: reads an unclosed quote to the end as one word", () => {
  expect(simpleCommands("cat 'dist")).toStrictEqual([["cat", "dist"]]);
  expect(simpleCommands('cat "a | b')).toStrictEqual([["cat", "a | b"]]);
});

it("holdsCommand: is true for a word with a blank or a shell operator", () => {
  for (const word of ["cat x", "a|b", "a;b", "$(a)", "`a`", "a>b", "a&b"]) expect(holdsCommand(word), word).toBe(true);

  for (const word of ["dist/x", "$HOME", "-n", "{}"]) expect(holdsCommand(word), word).toBe(false);
});
