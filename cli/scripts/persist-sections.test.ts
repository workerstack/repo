import { describe, expect, it } from "vitest";

import {
  capErrors,
  cardErrors,
  fencedLineSet,
  sectionBodies,
  unclosedFenceErrors,
  usageErrors,
} from "./persist-sections.ts";

function lines(text: string) {
  return text.split("\n");
}

describe("fencedLineSet", () => {
  it("marks fenced lines, fences included", () => {
    const { fenced, unclosed } = fencedLineSet(lines("a\n```\n## x\n```\nb"));
    expect([...fenced]).toStrictEqual([1, 2, 3]);
    expect(unclosed).toBeNull();
  });

  it("closes only on the same character, as long, with nothing after", () => {
    expect(fencedLineSet(lines("````\n```\n~~~\n````x\n````")).unclosed).toBeNull();
    expect(fencedLineSet(lines("```\n~~~")).unclosed).toBe(1);
    expect(fencedLineSet(lines("~~~\n```\n~~~~")).unclosed).toBeNull();
  });

  it("does not open on a backtick fence whose info text has a backtick", () => {
    expect(fencedLineSet(lines("```js `x`\ntext")).fenced.size).toBe(0);
    expect(fencedLineSet(lines("~~~ a`b\ntext")).unclosed).toBe(1);
  });
});

describe("unclosedFenceErrors", () => {
  it("names the line of a fence that never closes", () => {
    expect(unclosedFenceErrors("a\n```\nb")).toStrictEqual([
      "unclosed code fence at line 2: close it with the same fence",
    ]);
    expect(unclosedFenceErrors("a\n```\nb\n```")).toStrictEqual([]);
  });
});

describe("sectionBodies", () => {
  it("returns headings in order with their bodies, ignoring fenced headings", () => {
    const { order, bodies } = sectionBodies("# t\n## A\none\n```\n## no\n```\n## B\ntwo");
    expect(order).toStrictEqual(["A", "B"]);
    expect(bodies.A).toBe("one\n```\n## no\n```\n");
    expect(bodies.B).toBe("two");
  });
});

describe("usageErrors", () => {
  const fenced = { Usage: "```\n$ x\n```\n" };
  it("is required on a fresh save only", () => {
    expect(usageErrors(["Goal"], {}, { fresh: true })).toHaveLength(1);
    expect(usageErrors(["Goal"], {}, { fresh: false })).toStrictEqual([]);
  });

  it("wants Usage right after Goal with an example", () => {
    expect(usageErrors(["Goal", "Usage"], fenced, { fresh: true })).toStrictEqual([]);
    expect(usageErrors(["Goal", "Usage"], { Usage: "No visible change: x" }, { fresh: true })).toStrictEqual([]);
    expect(usageErrors(["Context", "Usage"], fenced, { fresh: true })).toStrictEqual([
      "## Usage must come right after ## Goal",
    ]);
    expect(usageErrors(["Goal", "Usage"], { Usage: "prose" }, { fresh: true })).toStrictEqual([
      '## Usage needs a fenced example or a "No visible change:" line',
    ]);
    expect(usageErrors(["Goal", "Usage"], {}, { fresh: true })).toHaveLength(1);
  });
});

function body(...rows: string[]) {
  return `# t\n\n${rows.join("\n")}\n\n## Goal`;
}
function numbered(n: number) {
  return Array.from({ length: n }, (_, i) => `line ${i}`).join("\n");
}

describe("cardErrors", () => {
  const card = ["WHAT   a", "WHY    b", "RISK   c", "TOUCH  d", "DONE   e"];
  it("accepts the five labelled lines", () => {
    expect(cardErrors(body(...card))).toStrictEqual([]);
  });

  it("asks for the card when no label line follows the title", () => {
    const want = ["start with the 5-line card after the title: WHAT, WHY, RISK, TOUCH, DONE"];
    expect(cardErrors("# t\ntext")).toStrictEqual(want);
    expect(cardErrors("# t\n\nplain")).toStrictEqual(want);
  });

  it("names each failing line", () => {
    expect(cardErrors(body("WHAT   a", "RISK   c", "RISK   c", "TOUCH  d", "DONE   e"))).toStrictEqual([
      "card line 2 must start with WHY",
    ]);
    expect(cardErrors(body("WHAT a", ...card.slice(1)))).toStrictEqual([
      'card line 1 (WHAT) needs its text at column 8: "WHAT   <text>"',
    ]);
    expect(cardErrors(body(`WHAT   ${"x".repeat(120)}`, ...card.slice(1)))).toStrictEqual([
      "card line 1 (WHAT) is 127 characters; the limit is 120",
    ]);
    expect(cardErrors(body(...card, "extra"))).toStrictEqual([
      "the card is 5 lines; end it with a blank line after DONE",
    ]);
  });
});

describe("capErrors", () => {
  it("holds a fresh save to the cap", () => {
    expect(capErrors(numbered(100), { fresh: true })).toStrictEqual([]);
    expect(capErrors(numbered(101), { fresh: true })).toStrictEqual([
      "101 lines above ## Previous mistakes, the cap is 100; split it into a roadmap (/write-roadmap)",
    ]);
  });

  it("lets an update grow only up to the saved file", () => {
    expect(capErrors(numbered(150), { fresh: false, previous: numbered(150) })).toStrictEqual([]);
    expect(capErrors(numbered(151), { fresh: false, previous: numbered(150) })).toHaveLength(1);
    expect(capErrors(numbered(101), { fresh: false })).toHaveLength(1);
  });

  it("stops counting at the mistakes log and skips matching lines outside fences", () => {
    expect(capErrors(`${numbered(100)}\n## Previous mistakes\n${numbered(50)}`, { fresh: true })).toStrictEqual([]);
    const skipped = `${numbered(3)}\n  Location: a\n\`\`\`\n  Location: b\n\`\`\``;
    expect(capErrors(skipped, { cap: 6, fix: "trim", fresh: true, skip: /^\s+Location:/ })).toStrictEqual([]);
    expect(capErrors(skipped, { cap: 5, fix: "trim", fresh: true, skip: /^\s+Location:/ })).toStrictEqual([
      "6 lines above ## Previous mistakes, the cap is 5; trim",
    ]);
  });
});
