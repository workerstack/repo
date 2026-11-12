import { expect, it } from "vitest";

import { rustSourceHits } from "./source-checks.ts";

function attribute(name: string) {
  return (
    `${name} sets a lint level in code; lint levels live on the command line, ` +
    "so fix the code or add a lint.skip entry with a reason"
  );
}

const BLOCK = "Rust comments use the line form (//, ///, //!); rewrite this /* */ as // lines";

/** A file of `count` one-token code lines. */
function lines(count: number, extra = ""): string {
  return `${"x;\n".repeat(count)}${extra}`;
}

it("flags the usage crate once per rule at the right place", () => {
  const source = "#[allow(dead_code)]\n/* old */\npub fn f(s: &str) -> u8 { s.parse().unwrap() }\n";
  expect(rustSourceHits("src/lib.rs", source)).toStrictEqual([
    { column: 1, file: "src/lib.rs", line: 1, message: attribute("#[allow]"), rule: "repo/rust-lint-attribute" },
    { column: 1, file: "src/lib.rs", line: 2, message: BLOCK, rule: "repo/rust-block-comment" },
  ]);
});

it("flags every lint level at any depth, outer and inner", () => {
  for (const level of ["allow", "expect", "warn", "deny", "forbid"]) {
    const hits = rustSourceHits("a.rs", `mod m {\n    #[${level}(x)]\n    fn f() {}\n}\n#![${level}(y)]\n`);
    expect(hits.map((h) => [h.line, h.column, h.message])).toStrictEqual([
      [2, 5, attribute(`#[${level}]`)],
      [5, 1, attribute(`#![${level}]`)],
    ]);
  }
});

it("flags a lint level inside cfg_attr", () => {
  const hits = rustSourceHits("a.rs", "#[cfg_attr(test, allow(x))]\n#![cfg_attr(a, derive(B), deny(y))]\n");
  expect(hits.map((h) => [h.line, h.message])).toStrictEqual([
    [1, attribute("#[cfg_attr(… allow)]")],
    [2, attribute("#![cfg_attr(… deny)]")],
  ]);
});

it("passes other attributes, lint names as values and lint words in strings", () => {
  const source = [
    "#[derive(Debug)]",
    '#[cfg_attr(feature = "warn", derive(Clone))]',
    "#[cfg_attr(test, cfg(all(a, b)), derive(Copy))]",
    "#[cfg_attr(test, allow = 1)]",
    "#[rustfmt::skip]",
    "#[cfg(test)]",
    '#[doc = "#[allow(x)]"]',
    "# allow",
    "#",
    "#[",
    "#[cfg_attr(a, [b])]",
    "#![",
    "fn allow() {}",
  ].join("\n");

  expect(rustSourceHits("a.rs", source)).toStrictEqual([]);
});

it("ignores a lint level written in a comment", () => {
  expect(rustSourceHits("a.rs", "// #[allow(x)]\n/// #[deny(x)]\n")).toStrictEqual([]);
});

it("passes line and doc comments", () => {
  expect(rustSourceHits("a.rs", "// a\n/// b\n//! c\nfn f() {}\n")).toStrictEqual([]);
});

it("flags every block comment form, nested as one", () => {
  const source = "/* a */\n/** b */\n/*! c */\nfn f() { /* d /* e */ f */ }\n";
  expect(rustSourceHits("a.rs", source).map((h) => [h.line, h.column, h.rule, h.message])).toStrictEqual([
    [1, 1, "repo/rust-block-comment", BLOCK],
    [2, 1, "repo/rust-block-comment", BLOCK],
    [3, 1, "repo/rust-block-comment", BLOCK],
    [4, 10, "repo/rust-block-comment", BLOCK],
  ]);
});

it("does not see a block comment inside a raw string", () => {
  expect(rustSourceHits("a.rs", 'let s = r##"/* "# */"##;\n')).toStrictEqual([]);
});

it("counts columns in characters", () => {
  const hits = rustSourceHits("a.rs", 'let s = "😀"; /* c */\n');
  expect(hits.map((h) => h.column)).toStrictEqual([14]);
});

it("passes 200 code lines and fails 201 at the line past the limit", () => {
  expect(rustSourceHits("a.rs", lines(200))).toStrictEqual([]);
  expect(rustSourceHits("a.rs", lines(201))).toStrictEqual([
    {
      column: 1,
      file: "a.rs",
      line: 201,
      message: "this file has 201 code lines over 200; split it into modules",
      rule: "repo/rust-max-lines",
    },
  ]);
});

it("does not count comments, blanks or a line shared with a comment twice", () => {
  const filler = "// c\n\n   \n//! d\n";
  expect(rustSourceHits("a.rs", lines(200, filler.repeat(50)))).toStrictEqual([]);
  expect(rustSourceHits("a.rs", lines(199, "x; // trailing\n// only\n"))).toStrictEqual([]);
  expect(rustSourceHits("a.rs", lines(199, "x; x;\nx;\n")).map((h) => h.rule)).toStrictEqual(["repo/rust-max-lines"]);
});

it("counts each line a multi-line string spans, and not a block comment", () => {
  const string = 'let s = "a\nb\nc";\n';
  expect(rustSourceHits("a.rs", lines(197, string))).toStrictEqual([]);
  expect(rustSourceHits("a.rs", lines(198, string)).map((h) => h.message)).toStrictEqual([
    "this file has 201 code lines over 200; split it into modules",
  ]);
  const comment = "/* a\nb\nc */\n";
  expect(rustSourceHits("a.rs", lines(200, comment)).map((h) => h.rule)).toStrictEqual(["repo/rust-block-comment"]);
});

it("orders hits by position", () => {
  const source = lines(201, "/* late */\n#[allow(x)]\n");
  expect(rustSourceHits("a.rs", `/* first */\n${source}`).map((h) => h.rule)).toStrictEqual([
    "repo/rust-block-comment",
    "repo/rust-max-lines",
    "repo/rust-block-comment",
    "repo/rust-lint-attribute",
  ]);
});

it("orders hits on one line by column and survives an attribute cut off by the end of the file", () => {
  expect(rustSourceHits("a.rs", "/* a */ #[allow(x)] /* b */").map((h) => h.column)).toStrictEqual([1, 9, 21]);
  expect(rustSourceHits("a.rs", "#")).toStrictEqual([]);
  expect(rustSourceHits("a.rs", "#!")).toStrictEqual([]);
  expect(rustSourceHits("a.rs", "#[")).toStrictEqual([]);
  expect(rustSourceHits("a.rs", "#[cfg_attr(")).toStrictEqual([]);
});
