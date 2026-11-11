import { expect, it } from "vitest";
import { lexRust } from "./lexer.ts";

/** The `kind:text` of each token, so a test reads the source back. */
const lex = (source: string): string[] => lexRust(source).map((t) => `${t.kind}:${source.slice(t.start, t.end)}`);

it("reads an empty file and whitespace as no tokens", () => {
  expect(lexRust("")).toStrictEqual([]);
  expect(lexRust(" \n\t ")).toStrictEqual([]);
});

it("reads line comments, doc forms included, up to the newline", () => {
  expect(lex("// a\n/// b\n//! c")).toStrictEqual(["line-comment:// a", "line-comment:/// b", "line-comment://! c"]);
});

it("nests block comments and ends an unterminated one at the end of the file", () => {
  expect(lex("/* a /* b */ c */ x")).toStrictEqual(["block-comment:/* a /* b */ c */", "ident:x"]);
  expect(lex("/** doc */ /*! inner */")).toStrictEqual(["block-comment:/** doc */", "block-comment:/*! inner */"]);
  expect(lex("x /* open /* never")).toStrictEqual(["ident:x", "block-comment:/* open /* never"]);
});

it("keeps comment openers inside strings out of the comment kinds", () => {
  expect(lex('let s = "/* not */ // no";')).toStrictEqual([
    "ident:let",
    "ident:s",
    "punct:=",
    'string:"/* not */ // no"',
    "punct:;",
  ]);
});

it("reads escapes in strings and an unterminated string to the end", () => {
  expect(lex('"a\\"b" x')).toStrictEqual(['string:"a\\"b"', "ident:x"]);
  expect(lex('"open\\')).toStrictEqual(['string:"open\\']);
});

it("reads raw strings whatever they hold", () => {
  expect(lex('r##"/* "# */"## x')).toStrictEqual(['string:r##"/* "# */"##', "ident:x"]);
  expect(lex('r"a\\" x')).toStrictEqual(['string:r"a\\"', "ident:x"]);
  expect(lex('br#"x"# cr"y"')).toStrictEqual(['string:br#"x"#', 'string:cr"y"']);
  expect(lex('r#"never closed')).toStrictEqual(['string:r#"never closed']);
});

it("reads byte and c strings and byte chars", () => {
  expect(lex('bc"x"')).toStrictEqual(["ident:bc", 'string:"x"']);
  expect(lex('b"a\\"" c"b"')).toStrictEqual(['string:b"a\\""', 'string:c"b"']);
  expect(lex("b'\\'' b'x'")).toStrictEqual(["char:b'\\''", "char:b'x'"]);
});

it("tells a lifetime from a char", () => {
  expect(lex("&'a str")).toStrictEqual(["punct:&", "lifetime:'a", "ident:str"]);
  expect(lex("'a' 'ab 'static")).toStrictEqual(["char:'a'", "lifetime:'ab", "lifetime:'static"]);
  expect(lex("'\\n' '\\'' '\\u{1F600}' '😀'")).toStrictEqual([
    "char:'\\n'",
    "char:'\\''",
    "char:'\\u{1F600}'",
    "char:'😀'",
  ]);
  expect(lex("'")).toStrictEqual(["punct:'"]);
  expect(lex("'\\")).toStrictEqual(["char:'\\"]);
  expect(lex("' ")).toStrictEqual(["punct:'"]);
});

it("reads identifiers, raw identifiers, numbers and punctuation", () => {
  expect(lex("r#type rx b c r#")).toStrictEqual([
    "ident:r#type",
    "ident:rx",
    "ident:b",
    "ident:c",
    "ident:r",
    "punct:#",
  ]);
  expect(lex("x1 0xFFu8 1.5")).toStrictEqual(["ident:x1", "other:0xFFu8", "other:1", "punct:.", "other:5"]);
  expect(lex("#![a] 😀")).toStrictEqual(["punct:#", "punct:!", "punct:[", "ident:a", "punct:]", "punct:😀"]);
});

it("gives every token an increasing, non-empty range", () => {
  const source = "fn f<'a>(x: &'a str) -> u8 { /* c */ r#\"q\"#; 'x'; b\"y\" } // end";
  const tokens = lexRust(source);
  let previousEnd = 0;
  for (const token of tokens) {
    expect(token.end).toBeGreaterThan(token.start);
    expect(token.start).toBeGreaterThanOrEqual(previousEnd);
    previousEnd = token.end;
  }
});
