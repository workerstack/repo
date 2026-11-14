import path from "node:path";

import { describe, expect, it } from "vitest";

import type { Visited } from "./shell-ast.types.ts";
import { readWord } from "./shell-fields.ts";
import { shellFlow } from "./shell-flow.ts";

/** A field's text, in `[…]` when it holds a blank. */
function shown(text: string): string {
  return text.includes(" ") ? `[${text}]` : text;
}

/** A visited command as the fields bash runs (`?raw` when unknown, `[a b]` for one that holds a blank) and its dir. */
function show(v: Visited): string {
  if (v.kind === "opaque") return `opaque(${v.cause})`;
  const words = v.words.map(readWord).map((r) => (r.literal ? shown(r.text) : `?${r.raw}`));

  return `${words.join(" ")} @${v.dir.known ? v.dir.path : `?${v.dir.cause}`}`;
}

/** The commands of `src` from `/r` that run something, not data or assignments alone, each as `show` gives it. */
function runs(src: string): string[] {
  const out: string[] = [];
  shellFlow(src, { cwd: "/r", env: { cdpath: "", home: "/h" }, p: path.posix }, (v) => {
    if (v.kind === "opaque" || (v.data === undefined && !/^[A-Za-z_]\w*=/.test(v.words[0]?.raw ?? "")))
      out.push(show(v));
  });

  return out;
}

describe("walk variables", () => {
  it("reads a variable the line set, and cd to it", () => {
    expect(runs("D=/a; cd $D && ls $D/x")).toStrictEqual(["cd /a @/r", "ls /a/x @/a"]);
    expect(runs("cd ~ && ls ~+")).toStrictEqual(["cd /h @/r", "ls /h @/h"]);
  });

  it("keeps a value both branches give, and loses one they differ on", () => {
    expect(runs("if c; then D=/a; else D=/a; fi; ls $D")).toStrictEqual(["c @/r", "ls /a @/r"]);
    expect(runs("c || D=/a; ls $D")).toStrictEqual(["c @/r", "ls ?$D @/r"]);
  });

  it("takes each command of && to succeed, so the right runs where the left left it and so does what follows", () => {
    expect(runs("cd /a && D=/b; ls $D")).toStrictEqual(["cd /a @/r", "ls /b @/a"]);
  });

  it("keeps the caller's variables past a subshell or a pipe, and takes a function's", () => {
    expect(runs("D=/a; (D=/b); ls $D")).toStrictEqual(["ls /a @/r"]);
    expect(runs("D=/a | true; ls $D")).toStrictEqual(["true @/r", "ls ?$D @/r"]);
    expect(runs("f() { D=/a; }; f; ls $D")).toStrictEqual(["f @/r", "ls /a @/r"]);
  });

  it("forgets every variable after (( … )), which may assign", () => {
    expect(runs("D=/a; ((n++)); ls $D")).toStrictEqual(["n++ @/r", "ls ?$D @/r"]);
  });

  it("walks a loop again while it changes a variable, then loses it", () => {
    expect(runs("D=/a; while c; do D=/b; done; ls $D")).toStrictEqual(["c @/r", "c @/r", "ls ?$D @/r"]);
  });
});

describe("walk braces past the cap", () => {
  it("visits a command whose braces make too many words as one it cannot read, and loses the dir and vars", () => {
    const cap = "opaque(braces that make too many words)";

    expect(runs("D=/a; echo {1..2000}; cd $D; ls")).toStrictEqual([
      cap,
      "cd ?$D @?braces that make too many words",
      "ls @?$D",
    ]);
  });

  it("feeds a script reader the cause when the command before it in a pipe makes too many words", () => {
    expect(runs("echo {1..2000} | sh")).toStrictEqual([
      "opaque(braces that make too many words)",
      "sh @/r",
      "opaque(braces that make too many words)",
    ]);
  });
});

describe("walk for and select", () => {
  it("walks the body once per known field of the list, in turn", () => {
    expect(runs('for b in x "y z"; do git push o $b; done')).toStrictEqual(["git push o x @/r", "git push o y z @/r"]);
    expect(runs('for b in x "y z"; do git push o "$b"; done')).toStrictEqual([
      "git push o x @/r",
      "git push o [y z] @/r",
    ]);
    expect(runs("for b in {x,y}*.ts; do echo $b; done")).toStrictEqual(["echo x*.ts @/r", "echo y*.ts @/r"]);
    expect(runs("L=a; for b in $L c; do echo $b; done")).toStrictEqual(["echo a @/r", "echo c @/r"]);
  });

  it("joins the passes, so a dir each pass moves is lost after the loop", () => {
    expect(runs("for d in a b; do cd $d; done; ls")).toStrictEqual([
      "cd a @/r",
      "cd b @/r/a",
      "ls @?a folder set in a branch",
    ]);
  });

  it("keeps the name unknown for a list it cannot read, a glob it cannot match, select, $@, or too many values", () => {
    const lists = ["$(ls)", "$X/*.ts", "a b c d e f g h i", "{a,b,c}{d,e,f}"];

    for (const list of lists) expect(runs(`for d in ${list}; do echo $d; done`), list).toContain("echo ?$d @/r");
    expect(runs("select d in a; do echo $d; done")).toContain("echo ?$d @/r");
    expect(runs("for d; do echo $d; done")).toStrictEqual(["echo ?$d @/r", "echo ?$d @/r"]);
  });

  it("runs no body for an empty list, and still runs what the list substitutes", () => {
    expect(runs("for d in; do echo $d; done")).toStrictEqual([]);
    expect(runs("for d in $(ls); do :; done")).toStrictEqual(["ls @/r", ": @/r", ": @/r"]);
  });
});
