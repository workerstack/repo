import type { Diagnostic, Fixer } from "@oxlint/plugins";
import { describe, expect, it } from "vitest";

import { ruleContext } from "../../dev/rule-harness.ts";
import { MESSAGE } from "./no-block-comment.constants.ts";
import { noBlockComment } from "./no-block-comment.ts";

type Edit = { range: [number, number]; text: string };
const FIXER = { replaceTextRange: (range: [number, number], text: string): Edit => ({ range, text }) };

/** The count of reports over `code` and the code with every fix applied, last range first. */
function run(code: string): { reports: number; fixed: string } {
  const reported: Diagnostic[] = [];
  const { context } = ruleContext({
    code,
    cwd: "/",
    filename: "/a.ts",
    options: [],
    report: (diagnostic) => reported.push(diagnostic),
  });
  const visitor = noBlockComment.create(context);
  visitor.Program?.({} /* the rule reads no node */ as never);
  const edits = reported.map(
    (report) =>
      report.fix?.(FIXER as unknown /* the one method the fixes call */ as Fixer) /* a fix is always given */ as Edit,
  );
  const fixed = edits
    .toSorted((a, b) => b.range[0] - a.range[0])
    .reduce((acc, { range, text }) => acc.slice(0, range[0]) + text + acc.slice(range[1]), code);
  expect(reported.every((report) => report.message === MESSAGE)).toBe(true);
  return { fixed, reports: reported.length };
}

const CASES: [string, string, string][] = [
  ["single line", "/* ignore */\nexport const a = 1;\n", "// ignore\nexport const a = 1;\n"],
  [
    "indented",
    "function f() {\n    /* ignore */\n    return 1;\n}\n",
    "function f() {\n    // ignore\n    return 1;\n}\n",
  ],
  [
    "multi-line with stars",
    "  /*\n   * A syntax error leaves no statement checked,\n   * so the file is skipped.\n   */\n  const a = 1;\n",
    "  // A syntax error leaves no statement checked,\n  // so the file is skipped.\n  const a = 1;\n",
  ],
  [
    "multi-line without stars",
    "  /* first\n  second\n  */\n  const a = 1;\n",
    "  // first\n  // second\n  const a = 1;\n",
  ],
  [
    "continuation indented past the comment keeps the table",
    "  /*\n  name   kind\n    a    1\n  */\n  const a = 1;\n",
    "  // name   kind\n  //   a    1\n  const a = 1;\n",
  ],
  [
    "starred table keeps its deeper indent",
    "/*\n * name   kind\n *   a    1\n */\nconst a = 1;\n",
    "// name   kind\n//   a    1\nconst a = 1;\n",
  ],
  ["an empty inner line", "/*\n * one\n *\n * two\n */\nconst a = 1;\n", "// one\n//\n// two\nconst a = 1;\n"],
  ["a blank inner line without stars", "/* one\n\ntwo */\nconst a = 1;\n", "// one\n//\n// two\nconst a = 1;\n"],
  ["an empty comment", "/**/\n/* */\nconst a = 1;\n", "//\n//\nconst a = 1;\n"],
  ["a comment at the end of the file", "const a = 1;\n/* end */", "const a = 1;\n// end"],
  ["a file of one comment", "/* only */", "// only"],
  ["windows line ends", "/*\r\n * one\r\n * two\r\n */\r\nconst a = 1;\r\n", "// one\r\n// two\r\nconst a = 1;\r\n"],
];

describe("no-block-comment fixes", () => {
  it.each(CASES)("rewrites %s", (_name, code, expected) => {
    const { reports, fixed } = run(code);
    expect(reports).toBeGreaterThan(0);
    expect(fixed).toBe(expected);
  });

  it("fixes two own-line comments in a row independently", () => {
    const { reports, fixed } = run("/* one */\n/* two\n * three */\nconst a = 1;\n");
    expect([reports, fixed]).toStrictEqual([2, "// one\n// two\n// three\nconst a = 1;\n"]);
  });

  it("converts an own-line reason before a wrapped cast", () => {
    const code = "const a = (\n  value\n  /* the schema parsed it above */\n) as Foo;\n";
    expect(run(code).fixed).toBe("const a = (\n  value\n  // the schema parsed it above\n) as Foo;\n");
  });
});

describe("no-block-comment keeps", () => {
  it.each([
    "/** doc */\nexport const a = 1;\n",
    "/**\n * doc\n */\nexport const a = 1;\n",
    "const x = y as /* checked above */ Z;\n",
    "export const t = /* @__PURE__ */ make();\n",
    "foo(/* none */);\n",
    "/* a */ code();\n",
    "code(); /* after */\n",
    "code(); /* a\n b */\n",
    "/* a\n b */ code();\n",
    "/*! license */\nexport const a = 1;\n",
    "/* global jQuery */\nexport const a = 1;\n",
    "/* eslint no-console: 0 */\nexport const a = 1;\n",
    "/* exported a */\nexport const a = 1;\n",
    "// already a line\nexport const a = 1;\n",
    'export const s = "/* not a comment */";\n',
  ])("%j", (code) => {
    expect(run(code)).toStrictEqual({ fixed: code, reports: 0 });
  });

  it("reports a banner that is not on the first line", () => {
    expect(run("const a = 1;\n/*! banner */\n").fixed).toBe("const a = 1;\n// ! banner\n");
  });

  it("converts a directive with the same text after the slashes", () => {
    expect(run("/* eslint-disable no-console */\nexport const a = 1;\n").fixed).toBe(
      "// eslint-disable no-console\nexport const a = 1;\n",
    );
  });
});
