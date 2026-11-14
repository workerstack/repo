import { expect, it } from "vitest";

import { closingBlock, parseApprovalReply, parseClosingBlock } from "./closing-line.ts";
import type { Approvable } from "./strategy.types.ts";

it("maps y in any case with no strategy to keep each file's value", () => {
  expect(parseApprovalReply("y")).toStrictEqual({ kind: "approve", strategy: null });
  expect(parseApprovalReply("Y")).toStrictEqual({ kind: "approve", strategy: null });
});

it("maps a strategy word, ignoring extra spaces", () => {
  expect(parseApprovalReply("y spawn-deep")).toStrictEqual({ kind: "approve", strategy: "spawn-deep" });
  expect(parseApprovalReply("y  free ")).toStrictEqual({ kind: "approve", strategy: "free" });
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
  "```\nplan 4 · spawn-fast\n  i  implement    i free · i fast · i deep\n" +
  "  h  hand off     h free · h fast · h deep\n     or reply to revise\n```";

const QUEUE: Approvable[] = [
  { advice: null, kind: "plan", serial: 4, strategy: "spawn-fast" },
  { advice: null, kind: "roadmap", serial: 10, strategy: "spawn-deep" },
];

it("renders the block for one item", () => {
  expect(closingBlock([{ advice: null, kind: "plan", serial: 4, strategy: "spawn-fast" }])).toBe(ONE);
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
  expect(parseClosingBlock(ONE.replace("i free · i fast · i deep", "i free · i fast"))).toBeNull();
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
    expect(parseApprovalReply(p)).toStrictEqual(approve(null));
});

it("hands off with the header strategies on h or hand off", () => {
  for (const p of ["h", "H", "hand off", "handoff", "Hand off."])
    expect(parseApprovalReply(p)).toStrictEqual(handoff(null));
  expect(parseApprovalReply("implement")).toStrictEqual(approve(null));
});

it("maps each exact word reply", () => {
  expect(parseApprovalReply("i free")).toStrictEqual(approve("free"));
  expect(parseApprovalReply("I FAST")).toStrictEqual(approve("spawn-fast"));
  expect(parseApprovalReply("i deep!")).toStrictEqual(approve("spawn-deep"));
  expect(parseApprovalReply("h free")).toStrictEqual(handoff("free"));
  expect(parseApprovalReply("h fast")).toStrictEqual(handoff("spawn-fast"));
  expect(parseApprovalReply("h deep")).toStrictEqual(handoff("spawn-deep"));
});

it("is unknown for each of the six retired codes, with no alias", () => {
  for (const code of ["if", "isf", "isd", "hf", "hsf", "hsd", "ISF", "isd!"])
    expect(parseApprovalReply(code), code).toStrictEqual(unknown(code));
});

it("infers a misspelled action and strategy after an action word", () => {
  expect(parseApprovalReply("implement fere")).toStrictEqual(approve("free"));
  expect(parseApprovalReply("i free")).toStrictEqual(approve("free"));
  expect(parseApprovalReply("h free")).toStrictEqual(handoff("free"));
  expect(parseApprovalReply("y spawn fats")).toStrictEqual(approve("spawn-fast"));
  expect(parseApprovalReply("y spawn-deep")).toStrictEqual(approve("spawn-deep"));
  expect(parseApprovalReply("y  free ")).toStrictEqual(approve("free"));
  expect(parseApprovalReply("h fast")).toStrictEqual(handoff("spawn-fast"));
  expect(parseApprovalReply(" H  Deep ")).toStrictEqual(handoff("spawn-deep"));
  expect(parseApprovalReply("hand of deep")).toStrictEqual(handoff("spawn-deep"));
  expect(parseApprovalReply("hand off spawn-fast")).toStrictEqual(handoff("spawn-fast"));
  expect(parseApprovalReply("implemnt fast")).toStrictEqual(approve("spawn-fast"));
  expect(parseApprovalReply("h spawn-fast")).toStrictEqual(handoff("spawn-fast"));
});

it("resolves i spwan-dep to spawn-deep (a transposition and a missing letter are two edits)", () => {
  expect(parseApprovalReply("i spwan-dep")).toStrictEqual(approve("spawn-deep"));
});

it("is a revision when the action resolves and the strategy words match nothing", () => {
  for (const r of ["h slow", "y review-medium", "h constructor", "h fast now", " Implement Slow! ", "y spawn deep now"])
    expect(parseApprovalReply(r), r).toBeNull();

  for (const r of ["i think so", "i have a question", "i like it", "i guess", "implement this", "h no"])
    expect(parseApprovalReply(r), r).toBeNull();
});

it("is unknown when a strategy inference is ambiguous", () => {
  expect(parseApprovalReply("i daet")).toStrictEqual(unknown("i daet"));
});

it("is unknown for the retired id and hd codes, and a revision for i default", () => {
  expect(parseApprovalReply("id")).toStrictEqual(unknown("id"));
  expect(parseApprovalReply("hd")).toStrictEqual(unknown("hd"));
  expect(parseApprovalReply("i default")).toBeNull();
});

it("is unknown for a code-shaped word that is no code", () => {
  expect(parseApprovalReply("isx")).toStrictEqual(unknown("isx"));
  expect(parseApprovalReply("hs")).toStrictEqual(unknown("hs"));
  expect(parseApprovalReply("is")).toStrictEqual(unknown("is"));
  expect(parseApprovalReply("HSX!")).toStrictEqual(unknown("HSX!"));
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
    expect(parseApprovalReply(p)).toBeNull();
});

const FAST: Approvable = { advice: null, kind: "fast-plan", serial: 3, strategy: "free" };
const FULL: Approvable = { advice: null, kind: "plan", serial: 4, strategy: "spawn-fast" };

const FAST_ROADMAP: Approvable = {
  advice: "spawn-deep because two slices",
  kind: "fast-roadmap",
  serial: 2,
  strategy: "free",
};

const FAST_ONE =
  "```\nfast-plan 3 · free\n  i  implement    i free · i fast · i deep\n" +
  "  h  hand off     h free · h fast · h deep\n     or reply to revise\n```";

it("renders and reads a fast plan's block as a plan's, with its strategy and the word rows", () => {
  expect(closingBlock([FAST])).toBe(FAST_ONE);
  expect(parseClosingBlock(`Saved.\n\n${FAST_ONE}\n`)).toStrictEqual([FAST]);
  expect(closingBlock([FULL, FAST]).split("\n")[1]).toBe("plan 4 · spawn-fast, then fast-plan 3 · free");
  expect(parseClosingBlock(closingBlock([FULL, FAST]))).toStrictEqual([QUEUE[0], FAST]);
});

it("renders and reads a fast roadmap's advice row", () => {
  const block = closingBlock([FAST_ROADMAP, FAST]);
  expect(block.split("\n").slice(1, 3)).toStrictEqual([
    "fast-roadmap 2 · free, then fast-plan 3 · free",
    "  fast-roadmap 2 advice: spawn-deep because two slices",
  ]);
  expect(parseClosingBlock(block)).toStrictEqual([FAST_ROADMAP, FAST]);
});

it("refuses a fast item without a strategy, with an unknown one, or with the bare rows", () => {
  expect(parseClosingBlock(FAST_ONE.replace(" · free", ""))).toBeNull();
  expect(parseClosingBlock(FAST_ONE.replace(" · free", " · default"))).toBeNull();
  expect(parseClosingBlock(ONE.replace(" · spawn-fast", ""))).toBeNull();
  expect(parseClosingBlock(FAST_ONE.replace("fast-plan", "fast-slice"))).toBeNull();
  expect(parseClosingBlock(FAST_ONE.replace("    i free · i fast · i deep", ""))).toBeNull();
});
