import { afterEach, describe, expect, it } from "vitest";

import { BUDGET, HERE, LEDGER, MAIN, contextTree, mainOf, mainWith } from "./__fixtures__/context-tree.ts";
import { removePlanted } from "./__fixtures__/planted-repo.ts";
import { contextProblems, measure } from "./check-context.ts";

afterEach(removePlanted);

const ZERO = { index: 0, rules: 0, skills: 0 };

describe("measure", () => {
  it("counts bytes per bucket: rules files, skill descriptions, the index", () => {
    expect(measure(contextTree(HERE))).toStrictEqual(HERE);
  });

  it("counts a folded description joined, multibyte text by bytes, and a broken skill as none", () => {
    const dir = contextTree(ZERO, {
      "agents/skills/broken/SKILL.md": "no frontmatter\n",
      "agents/skills/folded/SKILL.md": "---\nname: f\ndescription: >-\n  ab\n  cd\n---\n",
      "agents/skills/nodesc/SKILL.md": "---\nname: n\n---\n",
      "agents/skills/one/SKILL.md": "---\nname: one\ndescription: é\n---\n",
    });

    expect(measure(dir).skills).toBe(2 + "ab cd".length);
  });

  it("reads a tree with none of the buckets as zero", () => {
    expect(measure(contextTree(ZERO))).toStrictEqual(ZERO);
  });
});

const RISE = 'context: rules 5739 -> 6100 bytes (+361) over main; record it: bun repo check --write --reason "<why>"';
const STALE = "context: context-budget.json is stale: run bun repo check --write";

describe("contextProblems, a rise over main", () => {
  it("fails with no ledger line", () => {
    const dir = contextTree(HERE, { [BUDGET]: HERE });

    expect(contextProblems(dir, mainWith(MAIN))).toStrictEqual([RISE]);
  });

  it("passes with a ledger line for main's value and the measure", () => {
    const line = { bucket: "rules", from: 5739, reason: "why", to: 6100 };
    const dir = contextTree(HERE, { [BUDGET]: HERE, [LEDGER]: `${JSON.stringify(line)}\n` });

    expect(contextProblems(dir, mainWith(MAIN))).toStrictEqual([]);
  });

  it("fails when the ledger line has another from, to or bucket, and skips junk lines", () => {
    const lines = [
      { bucket: "rules", from: 5000, reason: "r", to: 6100 },
      { bucket: "rules", from: 5739, reason: "r", to: 6000 },
      { bucket: "index", from: 5739, reason: "r", to: 6100 },
    ];

    const text = `${lines.map((l) => JSON.stringify(l)).join("\n")}\nnot json\n{"bucket":1}\n\n`;
    const dir = contextTree(HERE, { [BUDGET]: HERE, [LEDGER]: text });

    expect(contextProblems(dir, mainWith(MAIN))).toStrictEqual([RISE]);
  });

  it("passes a drop and an unchanged budget", () => {
    const dir = contextTree(HERE, { [BUDGET]: HERE });

    expect(contextProblems(dir, mainWith({ ...HERE, rules: 7000 }))).toStrictEqual([]);
    expect(contextProblems(dir, mainWith(HERE))).toStrictEqual([]);
  });
});

const BROKEN = [
  [
    "a broken chain",
    [
      ["rules", 5739, 5900],
      ["rules", 5950, 6100],
    ],
  ],
  [
    "a chain through another bucket",
    [
      ["rules", 5739, 5900],
      ["index", 5900, 6100],
    ],
  ],
  [
    "a chain that overshoots",
    [
      ["rules", 5739, 5900],
      ["rules", 5900, 6200],
      ["rules", 6200, 5900],
    ],
  ],
] as const;

describe("contextProblems, a rise over chained ledger lines", () => {
  it("passes when the bucket's lines chain from main's value to the measure", () => {
    const lines = [
      { bucket: "rules", from: 5900, reason: "second", to: 6100 },
      { bucket: "index", from: 5739, reason: "other", to: 5900 },
      { bucket: "rules", from: 5739, reason: "first", to: 5900 },
    ];

    const dir = contextTree(HERE, { [BUDGET]: HERE, [LEDGER]: lines.map((l) => `${JSON.stringify(l)}\n`).join("") });

    expect(contextProblems(dir, mainWith(MAIN))).toStrictEqual([]);
  });

  it.each(BROKEN)("fails %s", (_name, rows) => {
    const text = rows.map(([bucket, from, to]) => `${JSON.stringify({ bucket, from, reason: "r", to })}\n`).join("");
    const dir = contextTree(HERE, { [BUDGET]: HERE, [LEDGER]: text });

    expect(contextProblems(dir, mainWith(MAIN))).toStrictEqual([RISE]);
  });
});

function staleOf(budget: string | Record<string, number | string>): string[] {
  return contextProblems(contextTree(HERE, { [BUDGET]: budget }), mainWith(HERE));
}

describe("contextProblems, the budget file", () => {
  it("fails a file that differs from the measure, or is no budget", () => {
    expect(staleOf({ ...HERE, rules: 1 })).toStrictEqual([STALE]);
    expect(staleOf("{")).toStrictEqual([STALE]);
    expect(staleOf({ rules: "x" })).toStrictEqual([STALE]);
  });

  it("passes with no budget file here, as in a consumer", () => {
    expect(contextProblems(contextTree(HERE), mainWith(MAIN))).toStrictEqual([]);
  });

  it("passes a file main lacks, a main copy that is no budget, and no main ref", () => {
    const dir = contextTree(HERE, { [BUDGET]: HERE });

    expect(contextProblems(dir, mainOf({}))).toStrictEqual([]);
    expect(contextProblems(dir, mainOf({ [BUDGET]: "{" }))).toStrictEqual([]);
    expect(contextProblems(dir, null)).toStrictEqual([]);
  });

  it("finds main through git when no reader is given; a dir outside git has none", () => {
    expect(contextProblems(contextTree(HERE, { [BUDGET]: HERE }))).toStrictEqual([]);
  });
});
