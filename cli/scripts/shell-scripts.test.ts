import { describe, expect, it } from "vitest";

import type { Script, Simple, Stdin } from "./shell-ast.types.ts";
import { lex } from "./shell-lex.ts";
import { shellParse } from "./shell-parse.ts";
import { pipedStdin, programAt, scriptsOf } from "./shell-scripts.ts";

const NONE: Stdin = { kind: "none" };
const CURL: Stdin = { cause: "curl", kind: "opaque" };

/** The simple command `src` parses to. */
function simple(src: string): Simple {
  const node = shellParse(lex(src));

  if (node.kind !== "simple") throw new Error(`not a simple command: ${src}`);

  return node;
}

/** Each script as its text, `+` marking one that runs in the caller's state, or `opaque(cause)`. */
function scripts(src: string, stdin: Stdin = NONE): string[] {
  return scriptsOf(simple(src), stdin).map((s: Script) => {
    if (s.kind === "opaque") return `opaque(${s.cause})`;
    const text = s.kind === "file" ? `file(${s.word.raw})` : s.text;

    return s.inherits ? `+${text}` : text;
  });
}

describe("scriptsOf eval and shells", () => {
  it("reads eval's words, in the caller's state only at program position", () => {
    expect(scripts("eval 'cd a' b")).toStrictEqual(["+cd a b"]);
    expect(scripts("x=1 eval c")).toStrictEqual(["+c"]);
    expect(scripts("xargs eval c")).toStrictEqual(["c"]);
  });

  it("reads a shell's -c script after its options, anywhere in the command", () => {
    expect(scripts("bash -c 'a b' x")).toStrictEqual(["a b"]);
    expect(scripts("xargs sh -ec a")).toStrictEqual(["a"]);
    expect(scripts("/bin/zsh -o errexit +O x --norc -c a")).toStrictEqual(["a"]);
    expect(scripts("bash.exe --rcfile f -c -- a")).toStrictEqual(["a"]);
    expect(scripts("bash -c")).toStrictEqual([]);
    expect(scripts("$SHELL -c a")).toStrictEqual(["a"]);
  });
});

describe("scriptsOf stdin", () => {
  it("reads stdin for a shell with no operand or -s, at program position or behind a runner", () => {
    expect(scripts("sh", { kind: "text", text: "a\n" })).toStrictEqual(["a\n"]);
    expect(scripts("bash -s x", CURL)).toStrictEqual(["opaque(curl)"]);
    expect(scripts("sudo -E bash", CURL)).toStrictEqual(["opaque(curl)"]);
    expect(scripts("sh")).toStrictEqual([]);
  });

  it("ignores stdin for a shell that is only an argument", () => {
    expect(scripts("echo sh", CURL)).toStrictEqual([]);
  });

  it("takes stdin from the last heredoc or here-string, and none from a file", () => {
    expect(scripts("sh <<E\na\nE")).toStrictEqual(["a\n"]);
    expect(scripts("sh <<< 'a b'")).toStrictEqual(["a b\n"]);
    expect(scripts("sh < f", CURL)).toStrictEqual([]);
    expect(scripts("sh 2> err", CURL)).toStrictEqual(["opaque(curl)"]);
  });
});

describe("scriptsOf command strings", () => {
  it("reads -c and --command of su, runuser, flock and script", () => {
    expect(scripts("su -c a root")).toStrictEqual(["a"]);
    expect(scripts("runuser -u x --command=a")).toStrictEqual(["a"]);
    expect(scripts("flock /l -c a")).toStrictEqual(["a"]);
    expect(scripts("script -q --command a")).toStrictEqual(["a"]);
    expect(scripts("su -c")).toStrictEqual([]);
  });

  it("reads env -S, and a shell after a plain env", () => {
    expect(scripts("env -S 'a b'")).toStrictEqual(["a b"]);
    expect(scripts("env --split-string=a")).toStrictEqual(["a"]);
    expect(scripts("env X=1 bash -c a")).toStrictEqual(["a"]);
  });

  it("reads watch's command after its options", () => {
    expect(scripts("watch -n 1 -d git status")).toStrictEqual(["git status"]);
  });
});

describe("scriptsOf trap and git", () => {
  it("reads trap's script at program position only", () => {
    expect(scripts("trap 'a' EXIT")).toStrictEqual(["a"]);
    expect(scripts("trap -- 'a' INT")).toStrictEqual(["a"]);
    expect(scripts("trap -p")).toStrictEqual([]);
    expect(scripts("echo trap a")).toStrictEqual([]);
  });

  it("reads git rebase -x and --exec, and nothing for other git commands", () => {
    expect(scripts("git rebase -x 'a b' main")).toStrictEqual(["a b"]);
    expect(scripts("git -C d rebase --exec=a")).toStrictEqual(["a"]);
    expect(scripts("git commit -x a")).toStrictEqual([]);
  });

  it("runs nothing for data words or a plain command", () => {
    expect(scriptsOf({ ...simple("eval a"), data: "fields" }, NONE)).toStrictEqual([]);
    expect(scriptsOf({ ...simple("eval a"), data: "value" }, NONE)).toStrictEqual([]);
    expect(scripts("ls -la")).toStrictEqual([]);
  });
});

describe("pipedStdin and programAt", () => {
  it("feeds an echo or printf line as a script, any other program as opaque, and nothing from no program", () => {
    expect(pipedStdin(simple("echo a 'b c'"))).toStrictEqual({ kind: "text", text: "a b c\n" });
    expect(pipedStdin(simple("printf a"))).toStrictEqual({ kind: "text", text: "a\n" });
    expect(pipedStdin(simple("/usr/bin/curl -s x"))).toStrictEqual({ cause: "curl", kind: "opaque" });
    expect(pipedStdin(simple("x=1"))).toStrictEqual({ kind: "none" });
  });

  it("finds the program past assignments", () => {
    expect(programAt(simple("a=1 b=2 c").words)).toBe(2);
    expect(programAt(simple("a=1").words)).toBe(1);
  });
});
