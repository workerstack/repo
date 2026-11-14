import { describe, expect, it } from "vitest";

import type { Part, Token } from "./shell-ast.types.ts";
import { isLiteral, quotedBody, scriptText, unquotedBody, wordAt } from "./shell-lex-word.ts";
import { lex, wordOf } from "./shell-lex.ts";

/** A token as short text: a word as typed, an operator, or a redirect with its target and any body. */
function show(token: Token): string {
  if (token.kind === "word") return token.word.raw;

  if (token.kind === "op") return token.op === "\n" ? "NL" : token.op;
  const { op, target, body } = token.redirect;

  return body === undefined ? `${op}[${target.raw}]` : `${op}[${target.raw}]{${scriptText(body)}}`;
}

function shown(src: string): string[] {
  return lex(src).map(show);
}

/** The parts of the word at the start of `src`, each as kind and text; `qlit` for quoted text, which never globs. */
function parts(src: string): string[] {
  return wordAt(src, 0).word.parts.map((part: Part) => {
    if (part.kind === "lit") return `${part.quoted ? "q" : ""}lit:${part.text}|${part.bash}`;

    return part.kind === "param" ? `param:${part.raw}:${part.substs.join(",")}` : `subst:${part.raw}:${part.body}`;
  });
}

describe("lex operators", () => {
  it("splits on every control operator, longest first", () => {
    expect(shown("a;;&b;;c;&d&&e||f|&g;h&i|j(k)")).toStrictEqual([
      "a",
      ";;&",
      "b",
      ";;",
      "c",
      ";&",
      "d",
      "&&",
      "e",
      "||",
      "f",
      "|&",
      "g",
      ";",
      "h",
      "&",
      "i",
      "|",
      "j",
      "(",
      "k",
      ")",
    ]);
  });
});

describe("lex redirects", () => {
  it("reads every redirect with its fd and target", () => {
    expect(shown("a &>>x <<<y &>z >>w >|v 2>&1 <&3 <>u <t >s 10>r")).toStrictEqual([
      "a",
      "&>>[x]",
      "<<<[y]",
      "&>[z]",
      ">>[w]",
      ">|[v]",
      ">&[1]",
      "<&[3]",
      "<>[u]",
      "<[t]",
      ">[s]",
      ">[r]",
    ]);
  });
});

describe("lex lines and heredocs", () => {
  it("skips blanks, CRLF, line joins and comments, and keeps line breaks", () => {
    expect(shown("a \t b\r\nc \\\nd # e f\ng#h")).toStrictEqual(["a", "b", "NL", "c", "d", "NL", "g#h"]);
  });

  it("attaches heredoc bodies in order, quoted ones literal", () => {
    expect(shown("cat <<A <<'B'\n$x\nA\n$y\nB\nnext")).toStrictEqual([
      "cat",
      "<<[A]{$x\n}",
      "<<['B']{$y\n}",
      "NL",
      "next",
    ]);
    expect(lex("cat <<'B'\n$y\nB")[1]).toMatchObject({ redirect: { body: { parts: [{ kind: "lit" }] } } });
    expect(lex("cat <<B\n$y\nB")[1]).toMatchObject({
      redirect: {
        body: {
          parts: [
            { kind: "param", quoted: true, raw: "$y" },
            { kind: "lit", text: "\n" },
          ],
        },
      },
    });
  });
});

/** Whether each expansion of the word `src` is quoted. */
function quoted(src: string): boolean[] {
  return wordAt(src, 0).word.parts.flatMap((part) => (part.kind === "param" ? [part.quoted] : []));
}

describe("lex heredoc forms", () => {
  it("strips leading tabs for <<-, drops a CR, and reads an unclosed body to the end", () => {
    expect(shown("cat <<-E\n\tone\r\n\tE\r\nafter")).toStrictEqual(["cat", "<<-[E]{one\n}", "NL", "after"]);
    expect(shown("cat <<E\nopen")).toStrictEqual(["cat", "<<[E]{open\n}", "NL"]);
    expect(shown('cat <<"E"\nq\nE')).toStrictEqual(["cat", '<<["E"]{q\n}', "NL"]);
    expect(shown("cat <<\\E\nq\nE")).toStrictEqual(["cat", "<<[\\E]{q\n}", "NL"]);
  });

  it("reads a process substitution as a word, not a redirect", () => {
    expect(shown("diff <(a) >(b)")).toStrictEqual(["diff", "<(a)", ">(b)"]);
  });

  it("gives the word of a word token only", () => {
    expect(wordOf(lex("a")[0])?.raw).toBe("a");
    expect(wordOf(lex(";")[0])).toBeNull();
    expect(wordOf(undefined)).toBeNull();
  });
});

describe("wordAt", () => {
  it("reads quotes, and joins adjacent literal text of the same quoting", () => {
    expect(parts(`a'b c'"d e"f`)).toStrictEqual(["lit:a|a", "qlit:b cd e|b cd e", "lit:f|f"]);
    expect(parts("'open")).toStrictEqual(["qlit:open|open"]);
    expect(parts('"\\"\\$\\x"')).toStrictEqual(['qlit:"$\\x|"$\\x']);
  });

  it("keeps a backslash before a plain character in text and drops it for bash", () => {
    expect(parts("a\\b\\ c\\")).toStrictEqual(["lit:a|a", "qlit:\\b |b ", "lit:c|c", "qlit:\\|\\"]);
    expect(parts("a\\\nb")).toStrictEqual(["lit:ab|ab"]);
    expect(parts('"a\\\nb"')).toStrictEqual(["qlit:ab|ab"]);
  });

  it("decodes $'…' and reads $\"…\" as double quotes", () => {
    expect(parts("$'a\\tb'")).toStrictEqual(["qlit:a\tb|a\tb"]);
    expect(parts('$"a $x"')).toStrictEqual(["qlit:a |a ", "param:$x:"]);
  });

  it("decodes every $'…' escape form, keeping one it does not know or past Unicode", () => {
    const text = "dist\u0001\n'\\q\\U7fffffff";

    expect(parts("$'\\x64\\u0069\\U00000073\\164\\cA\\n\\'\\q\\U7fffffff'")).toStrictEqual([`qlit:${text}|${text}`]);
  });

  it("skips quotes, escapes and backticks inside a substitution, and an unclosed quote to the end", () => {
    expect(parts("$(b ')' \\) \"(\" `d`)")).toStrictEqual(["subst:$(b ')' \\) \"(\" `d`):b ')' \\) \"(\" `d`"]);
    expect(parts("$(b 'c")).toStrictEqual(["subst:$(b 'c:b 'c"]);
  });
});

describe("wordAt expansions", () => {
  it("reads expansions, with the substitutions inside them", () => {
    expect(parts("$x$1$?${y:-$(z)}")).toStrictEqual(["param:$x:", "param:$1:", "param:$?:", "param:${y:-$(z)}:z"]);
    expect(parts("$((1+$(n)))")).toStrictEqual(["param:$((1+$(n))):n"]);
    expect(parts("${a:-`b`}")).toStrictEqual(["param:${a:-`b`}:b"]);
    expect(parts("${a:-$b$(c)}")).toStrictEqual(["param:${a:-$b$(c)}:c"]);
    expect(parts("a$")).toStrictEqual(["lit:a$|a$"]);
  });

  it("reads an unclosed expansion or substitution to the end", () => {
    expect(parts("${a")).toStrictEqual(["param:${a:"]);
    expect(parts("$((1")).toStrictEqual(["param:$((1:"]);
    expect(parts("$(a (b")).toStrictEqual(["subst:$(a (b:a (b"]);
  });

  it("reads substitutions with the script they run", () => {
    expect(parts("$(a (b) c)")).toStrictEqual(["subst:$(a (b) c):a (b) c"]);
    expect(parts("`a \\`b\\``")).toStrictEqual(["subst:`a \\`b\\``:a `b`"]);
    expect(parts('"`a`"')).toStrictEqual(["qlit:|", "subst:`a`:a"]);
    expect(parts("<(a)x")).toStrictEqual(["subst:<(a):a", "lit:x|x"]);
  });

  it("ends at a blank or an operator", () => {
    expect(wordAt("ab;c", 0)).toMatchObject({ end: 2, word: { raw: "ab" } });
  });
});

describe("word helpers", () => {
  it("reads an unquoted body as double-quoted text, escaping only \\ $ ` and a line break", () => {
    expect(scriptText(unquotedBody('a\\"\\$b $c\n'))).toBe('a\\"$b $c\n');
    expect(quotedBody("$c").parts).toStrictEqual([{ bash: "$c", kind: "lit", quoted: true, text: "$c" }]);
  });

  it("tells a literal word from one with an expansion", () => {
    expect(isLiteral(wordAt("'a'b", 0).word)).toBe(true);
    expect(isLiteral(wordAt("a$b", 0).word)).toBe(false);
  });

  it("marks an expansion inside double quotes as quoted, so bash does not split it", () => {
    expect(quoted('$a"$b"${c}"${d}"')).toStrictEqual([false, true, false, true]);
    expect(quoted('$((1))"$((2))"')).toStrictEqual([false, true]);
  });
});
