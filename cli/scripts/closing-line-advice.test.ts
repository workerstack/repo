import { expect, it } from "vitest";

import { closingBlock, parseClosingBlock } from "./closing-line.ts";
import type { Approvable } from "./strategy.types.ts";

const ROWS =
  "  i  implement    i free · i fast · i deep\n" +
  "  h  hand off     h free · h fast · h deep\n     or reply to revise\n```";

const PLAN_ADVICE = "spawn-deep because the hook and gate change together";

const WITH_ADVICE: Approvable = { advice: PLAN_ADVICE, kind: "plan", serial: 4, strategy: "spawn-fast" };
const NO_ADVICE: Approvable = { advice: null, kind: "plan", serial: 5, strategy: "free" };
const ROADMAP: Approvable = { advice: "free because it is small", kind: "roadmap", serial: 10, strategy: "spawn-deep" };

const FAST: Approvable = { kind: "fast-plan", serial: 3 };

const ONE = `\`\`\`\nplan 4 · spawn-fast\n  plan 4 advice: ${PLAN_ADVICE}\n${ROWS}`;

it("renders an advice row under the header for an item that has advice", () => {
  expect(closingBlock([WITH_ADVICE])).toBe(ONE);
});

it("renders no advice row for an item without advice", () => {
  expect(closingBlock([NO_ADVICE])).toBe(`\`\`\`\nplan 5 · free\n${ROWS}`);
});

it("renders one advice row per item that has advice, in header order", () => {
  expect(closingBlock([WITH_ADVICE, NO_ADVICE, ROADMAP])).toBe(
    "```\nplan 4 · spawn-fast, then plan 5 · free, then roadmap 10 · spawn-deep\n" +
      `  plan 4 advice: ${PLAN_ADVICE}\n  roadmap 10 advice: free because it is small\n${ROWS}`,
  );
});

it("leaves a fast-only block unchanged", () => {
  const fast: Approvable = { kind: "fast-plan", serial: 3 };

  expect(closingBlock([fast])).toBe("```\nfast-plan 3\n  i  implement\n  h  hand off\n     or reply to revise\n```");
});

it("reads the advice back from a block, alone, in a queue and after prose", () => {
  expect(parseClosingBlock(ONE)).toStrictEqual([WITH_ADVICE]);
  expect(parseClosingBlock(`Saved.\n\n${ONE}\n`)).toStrictEqual([WITH_ADVICE]);

  for (const items of [
    [WITH_ADVICE, NO_ADVICE, ROADMAP],
    [NO_ADVICE, ROADMAP],
    [FAST, WITH_ADVICE],
  ])
    expect(parseClosingBlock(closingBlock(items))).toStrictEqual(items);
});

it("reads a changed advice row as that advice and a dropped row as none", () => {
  expect(parseClosingBlock(ONE.replace("hook and gate", "hook alone"))).toStrictEqual([
    { ...WITH_ADVICE, advice: "spawn-deep because the hook alone change together" },
  ]);
  expect(parseClosingBlock(ONE.replace(`  plan 4 advice: ${PLAN_ADVICE}\n`, ""))).toStrictEqual([
    { ...WITH_ADVICE, advice: null },
  ]);
});

it("is not a block when the advice row is doubled or names another item", () => {
  expect(parseClosingBlock(ONE.replace("plan 4 advice", "plan 5 advice"))).toBeNull();
  expect(parseClosingBlock(ONE.replace("plan 4 advice", "roadmap 4 advice"))).toBeNull();
  expect(
    parseClosingBlock(
      ONE.replace(`  plan 4 advice: ${PLAN_ADVICE}\n`, `  plan 4 advice: ${PLAN_ADVICE}\n  plan 4 advice: x\n`),
    ),
  ).toBeNull();
  expect(parseClosingBlock(`\`\`\`\nplan 5 · free\n  plan 5 advice: x\n${ROWS}`)).toStrictEqual([
    { ...NO_ADVICE, advice: "x" },
  ]);
});

it("is not a block when an advice row is shown for a fast item", () => {
  expect(
    parseClosingBlock(
      "```\nfast-plan 3\n  fast-plan 3 advice: free because x\n" +
        "  i  implement\n  h  hand off\n     or reply to revise\n```",
    ),
  ).toBeNull();
});
