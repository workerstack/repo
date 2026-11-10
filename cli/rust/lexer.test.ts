import { expect, it } from "vitest";
import { lexRust } from "./lexer.ts";

/** The `kind:text` of each token, so a test reads the source back. */
const lex = (source: string): string[] => lexRust(source).map((t) => `${t.kind}:${source.slice(t.start, t.end)}`);

it("reads an empty file and whitespace as no tokens", () => {
  expect(lexRust("")).toEqual([]);
  expect(lexRust(" \n\t ")).toEqual([]);
});

it("reads line comments, doc forms included, up to the newline", () => {
  expect(lex("// a\n/// b\n//! c")).toEqual(["line-comment:// a", "line-comment:/// b", "line-comment://! c"]);
});

it("nests block comments and ends an unterminated one at the end of the file", () => {
  expect(lex("/* a /* b */ c */ x")).toEqual(["block-comment:/* a /* b */ c */", "ident:x"]);
  expect(lex("/** doc */ /*! inner */")).toEqual(["block-comment:/** doc */", "block-comment:/*! inner */"]);
  expect(lex("x /* open /* never")).toEqual(["ident:x", "block-comment:/* open /* never"]);
});

it("keeps comment openers inside strings out of the comment kinds", () => {
  expect(lex('let s = "/* not */ // no";')).toEqual([
    "ident:let",
    "ident:s",
    "punct:=",
    'string:"/* not */ // no"',
    "punct:;",
  ]);
});

it("reads escapes in strings and an unterminated string to the end", () => {
  expect(lex('"a\\"b" x')).toEqual(['string:"a\\"b"', "ident:x"]);
  expect(lex('"open\\')).toEqual(['string:"open\\']);
});

it("reads raw strings whatever they hold", () => {
  expect(lex('r##"/* "# */"## x')).toEqual(['string:r##"/* "# */"##', "ident:x"]);
  expect(lex('r"a\\" x')).toEqual(['string:r"a\\"', "ident:x"]);
  expect(lex('br#"x"# cr"y"')).toEqual(['string:br#"x"#', 'string:cr"y"']);
  expect(lex('r#"never closed')).toEqual(['string:r#"never closed']);
});

it("reads byte and c strings and byte chars", () => {
  expect(lex('bc"x"')).toEqual(["ident:bc", 'string:"x"']);
  expect(lex('b"a\\"" c"b"')).toEqual(['string:b"a\\""', 'string:c"b"']);
  expect(lex("b'\\'' b'x'")).toEqual(["char:b'\\''", "char:b'x'"]);
});

it("tells a lifetime from a char", () => {
  expect(lex("&'a str")).toEqual(["punct:&", "lifetime:'a", "ident:str"]);
  expect(lex("'a' 'ab 'static")).toEqual(["char:'a'", "lifetime:'ab", "lifetime:'static"]);
  expect(lex("'\\n' '\\'' '\\u{1F600}' '😀'")).toEqual(["char:'\\n'", "char:'\\''", "char:'\\u{1F600}'", "char:'😀'"]);
  expect(lex("'")).toEqual(["punct:'"]);
  expect(lex("'\\")).toEqual(["char:'\\"]);
  expect(lex("' ")).toEqual(["punct:'"]);
});

it("reads identifiers, raw identifiers, numbers and punctuation", () => {
  expect(lex("r#type rx b c r#")).toEqual(["ident:r#type", "ident:rx", "ident:b", "ident:c", "ident:r", "punct:#"]);
  expect(lex("x1 0xFFu8 1.5")).toEqual(["ident:x1", "other:0xFFu8", "other:1", "punct:.", "other:5"]);
  expect(lex("#![a] 😀")).toEqual(["punct:#", "punct:!", "punct:[", "ident:a", "punct:]", "punct:😀"]);
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
