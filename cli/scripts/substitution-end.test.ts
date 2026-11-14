import { describe, expect, it } from "vitest";

import { wordAt } from "./shell-lex-word.ts";

/** The body `wordAt` reads from the substitution `$(src)` followed by more text. */
function body(src: string): string {
  const [part] = wordAt(`$(${src})x`, 0).word.parts;

  return part?.kind === "subst" ? part.body : "";
}

describe("wordAt substitutions that hold a case", () => {
  it("reads the ) that ends a case pattern as part of the case, not the end of the substitution", () => {
    for (const src of [
      "case $f in *.ts) echo $f;; *) ls;; esac",
      "for f in a; do case $f in (a|b) x;; c) y;& esac; done",
      "case a in a) case b in b) z;; esac;; esac",
      "case a in a) (y);; esac",
      "case a in a) echo $(case b in b) z;; esac);; esac",
      "case a in\n  a) x\nesac",
      "echo a # ) a comment\n",
      "case a in @(a|b)) y;; esac",
      "cat <(ls) >f; echo ${x:-)} `)` \\)",
      "case x in esac",
      "case a b in a) x;; esac",
      "echo ${x:-${y}} ${z:-'}'} ${w:-\\}} @(a|')')",
    ])
      expect(body(src), src).toBe(src);
  });

  it("reads a comment with no newline after it to the end, so nothing closes the substitution", () => {
    expect(body("echo a # ")).toBe("echo a # )x");
  });

  it("reads case, in and esac only as words at their place in a command", () => {
    expect(body("echo case")).toBe("echo case");
    expect(body("x=case; echo a")).toBe("x=case; echo a");
    expect(body("echo a#b")).toBe("echo a#b");
    expect(body("case a in a) echo esac;; esac")).toBe("case a in a) echo esac;; esac");
    expect(body('case"a" b')).toBe('case"a" b');
  });
});
