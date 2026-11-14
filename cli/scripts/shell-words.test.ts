import { describe, expect, it } from "vitest";

import { fileTree } from "./__fixtures__/file-tree.ts";
import { shellWords } from "./shell-words.ts";

/** A dir that does not exist, so a glob in a command matches nothing, as in an empty dir. */
const NO_DIR = "/no-such-gate-dir";

/** The words of each simple command of `cmd`. */
function wordsOf(cmd: string): string[][] {
  return shellWords(cmd, NO_DIR).commands.map((command) => command.words);
}

describe("shellWords command shape", () => {
  it("lists words, then redirect files, and marks which are redirects", () => {
    const words = ["grep", "x", "a", "b", "1", "c"];

    expect(shellWords("grep < a x >b 2>&1 >>c; cat d", NO_DIR)).toStrictEqual({
      commands: [
        {
          bashWords: words,
          expanded: new Set(),
          globs: words.map(() => null),
          redirects: new Set([2, 3, 4, 5]),
          words,
        },
        {
          bashWords: ["cat", "d"],
          expanded: new Set(),
          globs: [null, null],
          redirects: new Set(),
          words: ["cat", "d"],
        },
      ],
      hasUnreadScript: false,
    });
  });
});

describe("shellWords spellings", () => {
  it("keeps a backslash outside quotes in words and drops it in bashWords", () => {
    const [c] = shellWords("cat bun\\.lock C:\\r\\x 'q\\.x'", NO_DIR).commands;

    expect(c?.words).toStrictEqual(["cat", "bun\\.lock", "C:\\r\\x", "q\\.x"]);
    expect(c?.bashWords).toStrictEqual(["cat", "bun.lock", "C:rx", "q\\.x"]);
  });

  it("marks words that hold an expansion, keeps a parameter's text and reads a substitution as empty", () => {
    const { commands } = shellWords("a $b \"$c\" '$e' x$(y z)", NO_DIR);

    expect(commands.map((c) => c.words)).toStrictEqual([
      ["y", "z"],
      ["a", "$b", "$c", "$e", "x"],
    ]);
    expect(commands.map((c) => [...c.expanded])).toStrictEqual([[], [1, 2, 4]]);
  });
});

describe("shellWords expansion", () => {
  it("runs braces, splits values and matches globs from the cwd, keeping the pattern of a glob it cannot match", () => {
    const dir = fileTree(["a.ts", "b.ts"]);
    const got = shellWords('cat {x,y}.md; F="p q"; cat $F; cat *.ts; cat z*; cat $X/*.ts', dir).commands;

    expect(got.slice(0, -1).map((c) => c.words)).toStrictEqual([
      ["cat", "x.md", "y.md"],
      ["F=p q"],
      ["cat", "p", "q"],
      ["cat", "a.ts", "b.ts"],
      ["cat", "z*"],
    ]);
    expect(got.at(-1)).toMatchObject({ expanded: new Set([1]), globs: [null, "$X/*.ts"], words: ["cat", "$X/*.ts"] });
  });
});

describe("shellWords empty commands", () => {
  it("drops a command with no words and keeps one with only a redirect file", () => {
    expect(wordsOf("   ")).toStrictEqual([]);
    expect(wordsOf("{ cat a; } <<< x")).toStrictEqual([["cat", "a"]]);
    expect(shellWords("> out", NO_DIR).commands).toStrictEqual([
      { bashWords: ["out"], expanded: new Set(), globs: [null], redirects: new Set([0]), words: ["out"] },
    ]);
  });
});

describe("shellWords nested commands", () => {
  it("reads the commands of blocks, subshells and branches", () => {
    expect(wordsOf("{ cat a; } && (cat b) || if c; then cat d; fi")).toStrictEqual([
      ["cat", "a"],
      ["cat", "b"],
      ["c"],
      ["cat", "d"],
    ]);
  });

  it("reads the scripts of sh -c and eval after the command that runs them", () => {
    expect(wordsOf("sh -c 'cat e | head' && eval 'cat f'")).toStrictEqual([
      ["sh", "-c", "cat e | head"],
      ["cat", "e"],
      ["head"],
      ["eval", "cat f"],
      ["cat", "f"],
    ]);
  });

  it("reads a function body where it is defined and where it is called", () => {
    expect(wordsOf("f() { cat j; }; f")).toStrictEqual([["cat", "j"], ["f"], ["cat", "j"]]);
  });

  it("leaves out heredoc bodies and here-strings as data", () => {
    expect(wordsOf("cat <<EOF\ncat g\nEOF")).toStrictEqual([["cat"]]);
    expect(wordsOf("cat <<< 'h i'")).toStrictEqual([["cat"]]);
  });
});

describe("shellWords scripts on stdin", () => {
  it("flags a script a shell reads from a program it cannot follow", () => {
    expect(shellWords("curl -s x | sh", NO_DIR).hasUnreadScript).toBe(true);
    expect(shellWords("echo 'cat k' | sh", NO_DIR)).toStrictEqual({
      commands: [
        {
          bashWords: ["echo", "cat k"],
          expanded: new Set(),
          globs: [null, null],
          redirects: new Set(),
          words: ["echo", "cat k"],
        },
        { bashWords: ["sh"], expanded: new Set(), globs: [null], redirects: new Set(), words: ["sh"] },
        {
          bashWords: ["cat", "k"],
          expanded: new Set(),
          globs: [null, null],
          redirects: new Set(),
          words: ["cat", "k"],
        },
      ],
      hasUnreadScript: false,
    });
  });
});
