import { describe, expect, it } from "vitest";

import { scrubText, stripFiller } from "./scrub-text-lib.ts";

const PREFIXES = [
  "can you please",
  "could you please",
  "would you please",
  "can you",
  "could you",
  "would you",
  "please",
  "i want you to",
  "i need you to",
  "i would like you to",
  "i'd like you to",
];

describe("stripFiller prefixes", () => {
  it.each(PREFIXES)("strips %s", (prefix) => {
    expect(stripFiller(`${prefix} ship it`)).toBe("ship it");
  });

  it("keeps text that carries no filler, typos included", () => {
    expect(stripFiller("make counter react app")).toBe("make counter react app");
    expect(stripFiller("can you make me a loook minimal ui")).toBe("make loook minimal ui");
  });
});

describe("stripFiller phrases", () => {
  it("strips a trailing thanks or please and a stray 'to ,'", () => {
    expect(stripFiller("make me a demo, thanks!")).toBe("make demo");
    expect(stripFiller("build the ui to , look small please")).toBe("build the ui look small");
  });

  it.each([
    ["make me an api", "make api"],
    ["i want the docs", "docs"],
    ["i need the logs", "logs"],
    ["i want a demo", "demo"],
    ["i need a patch", "patch"],
    ["i want coffee", "coffee"],
    ["i need coffee", "coffee"],
  ])("maps %s", (input, output) => {
    expect(stripFiller(input)).toBe(output);
  });
});

describe("scrubText", () => {
  it("turns a filler request into the bare one-liner", () => {
    expect(scrubText("please make me a counter react app ui loook minimal thanks")).toBe(
      "make counter react app ui loook minimal",
    );
  });

  it("joins lines, collapses whitespace and reads CRLF and CR as line breaks", () => {
    expect(scrubText("\n alpha \t\r\n\r\n\tbeta  gamma\rdelta\n\n")).toBe("alpha beta gamma delta");
  });

  it("returns an empty string for blank input", () => {
    expect(scrubText("")).toBe("");
    expect(scrubText(" \n\t\n")).toBe("");
  });

  it("flattens markdown without special handling and drops commas", () => {
    expect(scrubText("# Tasks\n\n- one\n- two\n\n```js\nadd(a, b)\n```")).toBe(
      "# Tasks - one - two ```js add(a b) ```",
    );
  });
});
