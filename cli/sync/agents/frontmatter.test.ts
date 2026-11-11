import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";
import { parse } from "yaml";

import { emitYaml, finalize, parseDoc, type YamlValue } from "./frontmatter.ts";

const GOLDEN = path.join(import.meta.dirname, "..", "fixtures", "golden");

describe("parseDoc", () => {
  it("splits frontmatter from a trimmed LF body", () => {
    expect(parseDoc("a.md", "\uFEFF---\r\nname: x\r\n---\r\n\r\n  body\r\nline two\r\n\r\n")).toStrictEqual({
      body: "body\nline two",
      data: { name: "x" },
    });
  });

  it("reads YAML 1.2: yes stays a string", () => {
    expect(parseDoc("a.md", "---\nflag: yes\nnum: 012\n---\n").data).toStrictEqual({ flag: "yes", num: 12 });
  });

  it("drops null values at every level", () => {
    const text = "---\na:\nb: 1\nc:\n  d: ~\n  e: 2\nf: [x, null]\n---\n";
    expect(parseDoc("a.md", text).data).toStrictEqual({ b: 1, c: { e: 2 }, f: ["x"] });
  });

  it("gives an empty mapping for an empty block", () => {
    expect(parseDoc("a.md", "---\n---\nbody")).toStrictEqual({ body: "body", data: {} });
  });

  it("names the file when the frontmatter is missing", () => {
    expect(() => parseDoc(".repo/rules/nofm.md", "# no fence\n")).toThrow(
      new Error(".repo/rules/nofm.md: missing frontmatter (start the file with a --- block)"),
    );
  });

  it("names the file and gives the parser message's first line when the YAML is broken", () => {
    const yaml = "name: [bad";
    let message = "";
    try {
      parse(yaml);
    } catch (error) {
      message = (error as Error).message;
    }
    const firstLine = message.split("\n")[0]!.trim().replace(/:$/, "");
    expect(firstLine).toMatch(/at line 1, column \d+$/);
    expect(() => parseDoc(".repo/subagents/bad.md", `---\n${yaml}\n---\n`)).toThrow(
      new Error(`.repo/subagents/bad.md: invalid frontmatter: ${firstLine}`),
    );
  });

  it("keeps the invalid-frontmatter message on one line", () => {
    expect(() => parseDoc("a.md", "---\nname: [bad\n---\n")).toThrow(/^a\.md: invalid frontmatter: [^\n]+$/);
  });

  it.each([
    ["an unclosed block", "---\nname: x\n", "no closing --- line"],
    ["a non-mapping", "---\n- x\n---\n", "expected a mapping"],
  ])("rejects %s", (_label, text, why) => {
    expect(() => parseDoc("a.md", text)).toThrow(new Error(`a.md: invalid frontmatter: ${why}`));
  });
});

describe("emitYaml", () => {
  const roundTrip = (entries: [string, YamlValue][], mode?: "claude") =>
    expect(parse(emitYaml(entries, mode))).toStrictEqual(Object.fromEntries(entries));

  it("writes lists and nested maps in block style, in the order given", () => {
    const entries: [string, YamlValue][] = [
      ["name", "x"],
      ["tools", ["Read", "Grep"]],
      [
        "nested",
        {
          // Out of sorted order on purpose: the emitter keeps the order it is given.
          b: 1,

          a: true,
        },
      ],
    ];
    expect(emitYaml(entries)).toBe("name: x\ntools:\n  - Read\n  - Grep\nnested:\n  b: 1\n  a: true\n");
    roundTrip(entries);
  });

  it("writes empty lists and maps in flow style", () => {
    expect(
      emitYaml([
        ["a", []],
        ["b", {}],
      ]),
    ).toBe("a: []\nb: {}\n");
  });

  it("drops nullish values at every level", () => {
    expect(
      emitYaml([
        ["a", null],
        ["b", undefined],
        ["c", { d: null }],
        ["e", ["x", null, undefined]],
      ]),
    ).toBe("c: {}\ne:\n  - x\n");
  });

  const ambiguous = [
    "yes",
    "No",
    "y",
    "on",
    "true",
    "null",
    "~",
    "012",
    "1_000",
    "1:20",
    "0x1f",
    "1e3",
    ".5",
    "2001-12-14",
    "",
    " lead",
    "trail ",
    "- a",
    "-",
    "a: b",
    "a:",
    "a #b",
    "#a",
    "[x]",
    "{x}",
    "@x",
    "%x",
    "`x",
    "!x",
    "&x",
    "*x",
    ">x",
    "|x",
    "'x",
    '"x',
    "---",
    "--- [",
  ];

  it.each(ambiguous)("quotes %j and reads it back", (value) => {
    expect(emitYaml([["k", value]])).toMatch(/^k: '/);
    roundTrip([["k", value]]);
  });

  it.each(["a, b", "x[y]", "a:b", "a#b", "-a", "=x", "?x", "Agent(scout, explore, plan)", "grok-4.7", "it's 'quoted'"])(
    "leaves %j bare by default",
    (value) => {
      expect(emitYaml([["k", value]])).toBe(`k: ${value}\n`);
      roundTrip([["k", value]]);
    },
  );

  it.each(["a, b", "x[y]", "{x", "a:b", "-a", "=x", "?x"])("quotes %j in claude mode", (value) => {
    expect(emitYaml([["k", value]], "claude")).toBe(`k: '${value}'\n`);
    roundTrip([["k", value]], "claude");
  });

  it("double-quotes strings with newlines or control characters", () => {
    expect(emitYaml([["k", "a\nb\tc"]])).toBe('k: "a\\nb\\tc"\n');
    roundTrip([["k", "a\nb\tc"]]);
  });

  it("quotes keys like values", () => {
    roundTrip([
      ["yes", "x"],
      ["a: b", 1],
    ]);
    expect(emitYaml([["yes", "x"]])).toBe("'yes': x\n");
  });

  it("writes special numbers", () => {
    roundTrip([
      ["n", 1.5],
      ["inf", Infinity],
      ["ninf", -Infinity],
    ]);
    expect(parse(emitYaml([["nan", NaN]])).nan).toBeNaN();
  });

  const agentFiles = ["claude", "agents", "grok", "cursor"].flatMap((host) =>
    fs.readdirSync(path.join(GOLDEN, `.${host}`, "agents")).map((name) => `.${host}/agents/${name}`),
  );

  it.each(agentFiles)("reproduces the frontmatter of golden %s", (rel) => {
    const text = fs.readFileSync(path.join(GOLDEN, rel), "utf8");
    const block = text.slice(4, text.indexOf("\n---\n", 4) + 1);
    const mode = rel.startsWith(".claude/") ? "claude" : "default";
    expect(emitYaml(Object.entries(parseDoc(rel, text).data) as [string, YamlValue][], mode)).toBe(block);
  });
});

describe("finalize", () => {
  it.each([
    ["a\r\nb\rc", "a\nb\nc\n"],
    ["a\n\n\n  ", "a\n"],
    ["", "\n"],
  ])("normalises %j", (text, want) => {
    expect(finalize(text)).toBe(want);
  });
});
