import path from "node:path";

import { describe, expect, it } from "vitest";

import type { Visited } from "./shell-ast.types.ts";
import { shellFlow } from "./shell-flow.ts";

/** A visited command as its words and dir, `?cause` for an unknown dir, or `opaque(cause)`. */
function show(v: Visited): string {
  if (v.kind === "opaque") return `opaque(${v.cause})`;

  return `${v.words.map((w) => w.raw).join(" ")} @${v.dir.known ? v.dir.path : `?${v.dir.cause}`}`;
}

/** Each command the walk visits from `/r`. */
function visits(src: string): string[] {
  const out: string[] = [];
  shellFlow(src, { cwd: "/r", env: { cdpath: "", home: "/h", path: "/bin" }, p: path.posix }, (v) => out.push(show(v)));

  return out;
}

describe("walk scope", () => {
  it("keeps a cd through && and ; and a group", () => {
    expect(visits("cd a && { cd b; git push; }; ls")).toStrictEqual([
      "cd a @/r",
      "cd b @/r/a",
      "git push @/r/a/b",
      "ls @/r/a/b",
    ]);
  });

  it("drops a cd made in a subshell, a pipe item, or in the background", () => {
    expect(visits("(cd a); cd b | cat; cd c & ls")).toStrictEqual([
      "cd a @/r",
      "cd b @/r",
      "cat @/r",
      "cd c @/r",
      "ls @/r",
    ]);
  });

  it("walks substitutions first, in a copy", () => {
    expect(visits('x="$(cd a; pwd)" ls')).toStrictEqual(["cd a @/r", "pwd @/r/a", 'x="$(cd a; pwd)" ls @/r']);
  });

  it("walks the substitutions inside an expansion", () => {
    expect(visits("echo ${x:-$(a)}")).toStrictEqual(["a @/r", "echo ${x:-$(a)} @/r"]);
  });

  it("walks the substitutions in redirects and heredoc bodies", () => {
    expect(visits("cat > $(a) <<E\n$(b)\nE")).toStrictEqual(["a @/r", "b @/r", "cat @/r"]);
  });
});

describe("walk joins", () => {
  it("joins || and if branches: one dir when they agree, unknown when not", () => {
    expect(visits("cd /x || cd /x; a")).toStrictEqual(["cd /x @/r", "cd /x @/x", "a @/x"]);
    expect(visits("cd a || true; b")).toStrictEqual(["cd a @/r", "true @/r/a", "b @/r/a"]);
    expect(visits("if a; then cd b; else cd c; fi; d").at(-1)).toBe("d @?a folder set in a branch");
    expect(visits("if a; then cd b; fi; d").at(-1)).toBe("d @?a folder set in a branch");
  });

  it("joins case arms with the case that matches none", () => {
    expect(visits("case $x in a) cd b;; esac; d")).toStrictEqual([
      "$x @/r",
      "cd b @/r",
      "d @?a folder set in a branch",
    ]);
  });

  it("walks a loop again when it moved the dir, at most twice", () => {
    expect(visits("while a; do cd b; done")).toStrictEqual([
      "a @/r",
      "cd b @/r",
      "a @?a folder set in a branch",
      "cd b @?a folder set in a branch",
    ]);
    expect(visits("while a; do b; done")).toStrictEqual(["a @/r", "b @/r"]);
  });
});

describe("walk functions", () => {
  it("walks a body at its definition and at each call, in the caller's state", () => {
    expect(visits("f() { cd a; }; f; g")).toStrictEqual(["cd a @/r", "f @/r", "cd a @/r", "g @/r/a"]);
  });

  it("stops a call that is already being walked", () => {
    expect(visits("f() { f; }; f")).toStrictEqual(["f @/r", "f @/r", "f @/r"]);
  });

  it("runs a defined function in place of the shell or the cd it is named after", () => {
    expect(visits("sh() { sed s/a/b/; }; cat x | sh")).toStrictEqual([
      "sed s/a/b/ @/r",
      "cat x @/r",
      "sh @/r",
      "sed s/a/b/ @/r",
    ]);
    expect(visits("cd() { :; }; cd a; b")).toStrictEqual([": @/r", "cd a @/r", ": @/r", "b @/r"]);
    expect(visits("sh() { :; }; env sh <<E\ngit push\nE")).toStrictEqual([": @/r", "env sh @/r", "git push @/r"]);
  });

  it("calls nothing for an undefined name or an empty command", () => {
    expect(visits("> out")).toStrictEqual([" @/r"]);
  });
});

describe("walk scripts", () => {
  it("runs eval at program position in the caller's state, and a shell's script in a copy", () => {
    expect(visits("eval 'cd a'; bash -c 'cd b'; c")).toStrictEqual([
      "eval 'cd a' @/r",
      "cd a @/r",
      "bash -c 'cd b' @/r/a",
      "cd b @/r/a",
      "c @/r/a",
    ]);
  });

  it("feeds a shell its heredoc, a here-string, a group's redirect, or a piped echo", () => {
    expect(visits("sh <<E\ngit push\nE")).toStrictEqual(["sh @/r", "git push @/r"]);
    expect(visits("{ sh; } <<< 'git push'")).toStrictEqual([" @/r", "sh @/r", "git push @/r"]);
    expect(visits("echo git push | sh")).toStrictEqual(["echo git push @/r", "sh @/r", "git push @/r"]);
  });

  it("hands on a script it cannot read, named by its source", () => {
    expect(visits("curl x | sh")).toStrictEqual(["curl x @/r", "sh @/r", "opaque(curl)"]);
    expect(visits("(echo x) | sh")).toStrictEqual(["echo x @/r", "sh @/r", "opaque(a command block)"]);
  });

  it("visits data words without running them", () => {
    expect(visits("for f in 'cd a'; do b; done; c")).toStrictEqual(["'cd a' @/r", "b @/r", "c @/r"]);
  });
});
