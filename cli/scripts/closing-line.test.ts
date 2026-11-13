import { expect, it } from "vitest";

import { approvalFor, closingBlock, parseApproval, parseClosingBlock } from "./closing-line.ts";
import type { Approvable } from "./strategy.types.ts";

it("maps y in any case with no strategy to keep each file's value", () => {
  expect(parseApproval("y")).toStrictEqual({ kind: "approve", strategy: null });
  expect(parseApproval("Y")).toStrictEqual({ kind: "approve", strategy: null });
});

it("maps a strategy word, ignoring extra spaces", () => {
  expect(parseApproval("y spawn-deep")).toStrictEqual({ kind: "approve", strategy: "spawn-deep" });
  expect(parseApproval("y  default ")).toStrictEqual({ kind: "approve", strategy: "default" });
});

function approve(strategy: string | null) {
  return { kind: "approve", strategy };
}

function handoff(strategy: string | null) {
  return { kind: "handoff", strategy };
}

function unknown(word: string) {
  return { kind: "unknown", word };
}

const ONE =
  "```\nplan 4 · spawn-fast\n  i  implement    id · isf · isd\n" +
  "  h  hand off     hd · hsf · hsd\n     or reply to revise\n```";

const QUEUE: Approvable[] = [
  { kind: "plan", serial: 4, strategy: "spawn-fast" },
  { kind: "roadmap", serial: 10, strategy: "spawn-deep" },
];

it("renders the block for one item", () => {
  expect(closingBlock([{ kind: "plan", serial: 4, strategy: "spawn-fast" }])).toBe(ONE);
});

it("joins a queue in the header and keeps the rows", () => {
  const block = closingBlock(QUEUE);

  expect(block.split("\n")[1]).toBe("plan 4 · spawn-fast, then roadmap 10 · spawn-deep");
  expect(block.split("\n").slice(2)).toStrictEqual(ONE.split("\n").slice(2));
});

it("refuses an empty block", () => {
  expect(() => closingBlock([])).toThrow("at least one item");
});

it("reads the items back from a block, alone or after prose", () => {
  expect(parseClosingBlock(closingBlock(QUEUE))).toStrictEqual(QUEUE);
  expect(parseClosingBlock(`Strategy notes.\n\n- a\n\n${ONE}\n`)).toStrictEqual([QUEUE[0]]);
  expect(parseClosingBlock(`${ONE}\n\n  \n`)).toStrictEqual([QUEUE[0]]);
});

it("reads the last block when an earlier fenced block exists", () => {
  expect(parseClosingBlock(`\`\`\`\ncode\n\`\`\`\n\ntext\n${ONE}`)).toStrictEqual([QUEUE[0]]);
});

it("ignores trailing whitespace on block lines", () => {
  expect(parseClosingBlock(ONE.replaceAll("\n", "  \n"))).toStrictEqual([QUEUE[0]]);
});

it("is null for a changed row, a missing fence, text after, an unknown strategy or nothing", () => {
  expect(parseClosingBlock(ONE.replace("hand off", "handoff"))).toBeNull();
  expect(parseClosingBlock(ONE.replace("id · isf · isd", "id · isf"))).toBeNull();
  expect(parseClosingBlock(ONE.replace(/\n```$/, ""))).toBeNull();
  expect(parseClosingBlock(ONE.replace(/^```\n/, ""))).toBeNull();
  expect(parseClosingBlock(`${ONE}\nthanks`)).toBeNull();
  expect(parseClosingBlock(ONE.replace("spawn-fast", "spawn-slow"))).toBeNull();
  expect(parseClosingBlock(ONE.replace("plan 4", "slice 4"))).toBeNull();
  expect(parseClosingBlock("```ts\ncode\n```")).toBeNull();
  expect(parseClosingBlock("```\n```")).toBeNull();
  expect(parseClosingBlock("")).toBeNull();
});

it("approves with the header strategies on a short yes, in any case, ignoring . and !", () => {
  for (const p of ["i", "y", "yes", "go", "do it", "I", "Go!", "yes.", " Do   it! ", "y!!"])
    expect(parseApproval(p)).toStrictEqual(approve(null));
});

it("hands off with the header strategies on h or hand off", () => {
  for (const p of ["h", "H", "hand off", "handoff", "Hand off."]) expect(parseApproval(p)).toStrictEqual(handoff(null));
  expect(parseApproval("implement")).toStrictEqual(approve(null));
});

it("maps each exact code", () => {
  expect(parseApproval("id")).toStrictEqual(approve("default"));
  expect(parseApproval("isf")).toStrictEqual(approve("spawn-fast"));
  expect(parseApproval("ISF")).toStrictEqual(approve("spawn-fast"));
  expect(parseApproval("isd!")).toStrictEqual(approve("spawn-deep"));
  expect(parseApproval("hd")).toStrictEqual(handoff("default"));
  expect(parseApproval("hsf")).toStrictEqual(handoff("spawn-fast"));
  expect(parseApproval("hsd")).toStrictEqual(handoff("spawn-deep"));
});

it("infers a misspelled action and strategy after an action word", () => {
  expect(parseApproval("implement deafult")).toStrictEqual(approve("default"));
  expect(parseApproval("y spawn fats")).toStrictEqual(approve("spawn-fast"));
  expect(parseApproval("y spawn-deep")).toStrictEqual(approve("spawn-deep"));
  expect(parseApproval("y  default ")).toStrictEqual(approve("default"));
  expect(parseApproval("h fast")).toStrictEqual(handoff("spawn-fast"));
  expect(parseApproval(" H  Deep ")).toStrictEqual(handoff("spawn-deep"));
  expect(parseApproval("hand of deep")).toStrictEqual(handoff("spawn-deep"));
  expect(parseApproval("hand off spawn-fast")).toStrictEqual(handoff("spawn-fast"));
  expect(parseApproval("implemnt fast")).toStrictEqual(approve("spawn-fast"));
  expect(parseApproval("h spawn-fast")).toStrictEqual(handoff("spawn-fast"));
});

it("resolves i spwan-dep to spawn-deep (a transposition and a missing letter are two edits)", () => {
  expect(parseApproval("i spwan-dep")).toStrictEqual(approve("spawn-deep"));
});

it("is a revision when the action resolves and the strategy words match nothing", () => {
  for (const r of ["h slow", "y review-medium", "h constructor", "h fast now", " Implement Slow! ", "y spawn deep now"])
    expect(parseApproval(r), r).toBeNull();

  for (const r of ["i think so", "i have a question", "i like it", "i guess", "implement this", "h no"])
    expect(parseApproval(r), r).toBeNull();
});

it("is unknown when a strategy inference is ambiguous", () => {
  expect(parseApproval("i daet")).toStrictEqual(unknown("i daet"));
});

it("is unknown for a code-shaped word that is no code", () => {
  expect(parseApproval("isx")).toStrictEqual(unknown("isx"));
  expect(parseApproval("hs")).toStrictEqual(unknown("hs"));
  expect(parseApproval("is")).toStrictEqual(unknown("is"));
  expect(parseApproval("HSX!")).toStrictEqual(unknown("HSX!"));
});

it("is null for a revision", () => {
  for (const p of [
    "go with B but change X",
    "test",
    "keep",
    "help",
    "hi",
    "hm",
    "",
    "   ",
    "n",
    "ya",
    "yes please",
    "deafult",
    "spawn-fast",
    "fast",
    "deep",
    "xyzzy plugh",
    "one two three four five",
    "Please change the plan to use a queue instead of a list",
  ])
    expect(parseApproval(p)).toBeNull();
});

const FAST_ONE = "```\nfast-plan 3\n  i  implement\n  h  hand off\n     or reply to revise\n```";

const FAST: Approvable = { kind: "fast-plan", serial: 3 };
const FULL: Approvable = { kind: "plan", serial: 4, strategy: "spawn-fast" };

const MIXED =
  "```\nplan 4 · spawn-fast, then fast-plan 3\n  i  implement    id · isf · isd\n" +
  "  h  hand off     hd · hsf · hsd\n     or reply to revise\n```";

it("renders and reads the all-fast block with only the i and h rows", () => {
  expect(closingBlock([FAST])).toBe(FAST_ONE);
  expect(closingBlock([FAST, { kind: "fast-plan", serial: 5 }]).split("\n")[1]).toBe("fast-plan 3, then fast-plan 5");
  expect(parseClosingBlock(`Saved.\n\n${FAST_ONE}\n`)).toStrictEqual([FAST]);
});

it("renders and reads a mixed queue with the full rows", () => {
  expect(closingBlock([FULL, FAST])).toBe(MIXED);
  expect(parseClosingBlock(MIXED)).toStrictEqual([QUEUE[0], FAST]);
});

it("refuses a fast block with a strategy, a full item without one, or the wrong rows", () => {
  expect(parseClosingBlock(FAST_ONE.replace("fast-plan 3", "fast-plan 3 · default"))).toBeNull();
  expect(parseClosingBlock(ONE.replace(" · spawn-fast", ""))).toBeNull();
  expect(parseClosingBlock(FAST_ONE.replace("hand off", "handoff"))).toBeNull();
  expect(parseClosingBlock(MIXED.replace("plan 4", "fast-plan 4"))).toBeNull();
  expect(parseClosingBlock(FAST_ONE.replace("fast-plan", "fast-slice"))).toBeNull();
  expect(parseClosingBlock(FAST_ONE.replace("i  implement", "i  implement    id · isf · isd"))).toBeNull();
});

it("on an all-fast block a bare approval or handoff stands and every code or strategy word is unknown", () => {
  for (const p of ["i", "y", "yes", "go", "do it", "implement"])
    expect(approvalFor(p, [FAST])).toStrictEqual(approve(null));

  expect(approvalFor("h", [FAST])).toStrictEqual(handoff(null));

  for (const p of ["id", "isf", "isd", "hd", "hsf", "hsd", "h fast", "y spawn-deep"])
    expect(approvalFor(p, [FAST]), p).toStrictEqual(unknown(p));
});

it("on a block with a strategy item every code stands, and a revision stays null", () => {
  expect(approvalFor("isf", [FAST, FULL])).toStrictEqual(approve("spawn-fast"));
  expect(approvalFor("isf", QUEUE)).toStrictEqual(approve("spawn-fast"));
  expect(approvalFor("keep it", [FAST])).toBeNull();
  expect(approvalFor("isx", [FAST])).toStrictEqual(unknown("isx"));
});
