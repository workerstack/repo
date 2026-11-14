import { describe, expect, it } from "vitest";

import type { ShellNode, Simple } from "./shell-ast.types.ts";
import { lex } from "./shell-lex.ts";
import { shellParse } from "./shell-parse.ts";

/** A simple command as its words and redirects in brackets, marked when it is data. */
function showSimple(node: Simple): string {
  const words = [...node.words.map((w) => w.raw), ...node.redirects.map((r) => `${r.op}${r.target.raw}`)].join(" ");

  return node.data === undefined ? `[${words}]` : `data[${words}]`;
}

/** A command tree as short text: a simple command is its words in brackets, a node its kind and children. */
function show(node: ShellNode): string {
  if (node.kind === "simple") return showSimple(node);

  if (node.kind === "seq" || node.kind === "pipe") return `${node.kind}(${node.items.map(show).join(", ")})`;

  if (node.kind === "or") return `or(${show(node.left)}, ${show(node.right)})`;

  if (node.kind === "async" || node.kind === "subshell") return `${node.kind}(${show(node.body)})`;

  return showCompound(node);
}

/** A compound command node as short text. */
function showCompound(
  node: Exclude<ShellNode, { kind: "simple" | "seq" | "pipe" | "or" | "async" | "subshell" }>,
): string {
  if (node.kind === "if") {
    const branches = [node.cond, node.body, node.orElse].filter((n) => n !== undefined);

    return `if(${branches.map(show).join(", ")})`;
  }

  if (node.kind === "loop") return `loop(${show(node.cond)}, ${show(node.body)})`;

  if (node.kind === "for") {
    const words = node.words === null ? '"$@"' : showSimple(node.words);

    return `${node.select === true ? "select" : "for"} ${node.name}(${words}; ${show(node.body)})`;
  }

  if (node.kind === "case") return `case(${showSimple(node.word)}; ${node.arms.map(show).join("; ")})`;

  if (node.kind === "redir")
    return `redir(${node.redirects.map((r) => `${r.op}${r.target.raw}`).join(" ")}; ${show(node.body)})`;

  return `func ${node.name}(${show(node.body)})`;
}

function tree(src: string): string {
  return show(shellParse(lex(src)));
}

describe("parse lists", () => {
  it("runs && in sequence, folds || left, and sends & off", () => {
    expect(tree("a && b || c; d &")).toBe("seq(or(seq([a], [b]), [c]), async([d]))");
    expect(tree("a &&\n b ||\n c")).toBe("or(seq([a], [b]), [c])");
    expect(tree("a\n\nb;")).toBe("seq([a], [b])");
  });

  it("pipes, past ! and time", () => {
    expect(tree("! time -p a | b |&\n c")).toBe("pipe([a], [b], [c])");
    expect(tree("time a")).toBe("[a]");
  });

  it("keeps a subshell apart and a group in its state", () => {
    expect(tree("(cd x && git push) | tee y")).toBe("pipe(subshell(seq([cd x], [git push])), [tee y])");
    expect(tree("{ a; b; } > out")).toBe("redir(>out; seq([a], [b]))");
    expect(tree("((x))")).toBe("subshell(subshell([x]))");
  });
});

describe("parse compound commands", () => {
  it("reads if, elif and else", () => {
    expect(tree("if a; then b; fi")).toBe("if([a], [b])");
    expect(tree("if a; then b; elif c; then d; else e; fi 2>x")).toBe("redir(>x; if([a], [b], if([c], [d], [e])))");
  });

  it("reads while, until, for and select, the head of a for as data", () => {
    expect(tree("while read l; do p; done < f")).toBe("redir(<f; loop([read l], [p]))");
    expect(tree("until a\ndo b\ndone")).toBe("loop([a], [b])");
    expect(tree("for f in a $b; do echo $f; done")).toBe("for f(data[a $b]; [echo $f])");
    expect(tree("for f in; do x; done")).toBe("for f(data[]; [x])");
    expect(tree("for f\ndo x; done")).toBe('for f("$@"; [x])');
    expect(tree("for f; do x; done")).toBe('for f("$@"; [x])');
    expect(tree("for")).toBe('for ("$@"; seq())');
    expect(tree("for ((i=0; i<3; i++)); do x; done")).toBe("seq(data[i=0 i 3 i++], loop(seq(), [x]))");
    expect(tree("select f in a; do x; done")).toBe("select f(data[a]; [x])");
  });

  it("reads case arms with every arm end", () => {
    expect(tree("case $x in a|b) y;; (c) z;& d) w;;& esac")).toBe("case(data[$x]; [y]; [z]; [w])");
    expect(tree("case $x in\n a) y\nesac")).toBe("case(data[$x]; [y])");
    expect(tree("case x in a")).toBe("case(data[x]; )");
  });
});

describe("parse functions and tests", () => {
  it("reads both function forms", () => {
    expect(tree("f() { git push; }; f")).toBe("seq(func f([git push]), [f])");
    expect(tree("f ()\n(a)")).toBe("func f(subshell([a]))");
    expect(tree("function g { h; }")).toBe("func g([h])");
    expect(tree("function g() { h; }")).toBe("func g([h])");
  });

  it("reads [[ … ]] as one command, its operators skipped", () => {
    expect(tree("[[ -f x && -d y ]] && z")).toBe("seq([[[ -f x -d y], [z])");
    expect(tree("[[ a < b ]]")).toBe("[[[ a b]");
  });

  it("keeps the words of a simple command with its redirects", () => {
    expect(tree("a > x b 2>&1")).toBe("[a b >x >&1]");
    expect(tree("x=1 a")).toBe("[x=1 a]");
  });
});

describe("parse leniency", () => {
  it("closes an unclosed construct at the end and skips a stray closer", () => {
    expect(tree("if a; then (b")).toBe("if([a], subshell([b]))");
    expect(tree("while a; do { b")).toBe("loop([a], [b])");
    expect(tree("a; fi; b ) c; done }")).toBe("seq([a], [b], [c], seq())");
    expect(tree("")).toBe("seq()");
    expect(tree("a |")).toBe("pipe([a], [])");
    expect(tree("function")).toBe("func ([])");
  });

  it("reads reserved words only at the start of a command", () => {
    expect(tree("echo if then fi done")).toBe("[echo if then fi done]");
  });
});
