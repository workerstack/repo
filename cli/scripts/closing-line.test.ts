import { expect, it } from "vitest";

import { closingLine, parseApproval, parseClosingLine } from "./closing-line.ts";
import type { Approvable } from "./strategy.types.ts";

const FRESH = 'or "h" / "h fast" / "h deep" for a fresh session.';

it("renders a single item with the other two values as the or list", () => {
  expect(closingLine([{ kind: "plan", serial: 4, strategy: "spawn-fast" }])).toBe(
    `Reply "y" to run plan 4 (strategy: spawn-fast), or "y default" / "y spawn-deep", ${FRESH}`,
  );
});

it("renders a mixed queue with every value in the or list", () => {
  expect(
    closingLine([
      { kind: "plan", serial: 4, strategy: "spawn-fast" },
      { kind: "plan", serial: 5, strategy: "default" },
    ]),
  ).toBe(
    'Reply "y" to run plan 4 (strategy: spawn-fast), then plan 5 (strategy: default), ' +
      `or "y default" / "y spawn-fast" / "y spawn-deep", ${FRESH}`,
  );
});

it("leaves out the value every item already holds", () => {
  expect(
    closingLine([
      { kind: "plan", serial: 1, strategy: "default" },
      { kind: "roadmap", serial: 2, strategy: "default" },
    ]),
  ).toBe(
    'Reply "y" to run plan 1 (strategy: default), then roadmap 2 (strategy: default), ' +
      `or "y spawn-fast" / "y spawn-deep", ${FRESH}`,
  );
});

it("offers the fresh-session handoffs after the strategy choices", () => {
  expect(closingLine([{ kind: "plan", serial: 18, strategy: "spawn-deep" }])).toBe(
    `Reply "y" to run plan 18 (strategy: spawn-deep), or "y default" / "y spawn-fast", ${FRESH}`,
  );
});

it("refuses an empty queue", () => {
  expect(() => closingLine([])).toThrow("closingLine needs at least one item");
});

const queues: [Approvable[], Approvable[], Approvable[]] = [
  [{ kind: "plan", serial: 4, strategy: "spawn-fast" }],
  [
    { kind: "plan", serial: 4, strategy: "spawn-fast" },
    { kind: "roadmap", serial: 5, strategy: "default" },
    { kind: "plan", serial: 6, strategy: "spawn-deep" },
  ],
  [
    { kind: "plan", serial: 1, strategy: "default" },
    { kind: "plan", serial: 2, strategy: "default" },
  ],
];

it("round-trips what closingLine renders", () => {
  for (const q of queues) expect(parseClosingLine(closingLine(q))).toStrictEqual(q);
});

it("strips markdown wrapping the way a bold or quoted line arrives", () => {
  const [, , q] = queues;
  expect(parseClosingLine(`**${closingLine(q)}**`)).toStrictEqual(q);
  expect(parseClosingLine(`> \`${closingLine(q)}\` `)).toStrictEqual(q);
});

it("returns null for a hand-edited or legacy line", () => {
  const [first] = queues;
  const line = closingLine(first);
  expect(parseClosingLine(line.replace('"y default" / "y spawn-deep"', '"y spawn-deep"'))).toBeNull();
  expect(parseClosingLine(line.replace("spawn-fast", "review-medium"))).toBeNull();
  expect(parseClosingLine('Reply "y" to run plan 4.')).toBeNull();
  expect(
    parseClosingLine('Reply "y" to run plan 4 (strategy: spawn-fast), or "y default" / "y spawn-deep".'),
  ).toBeNull();
  expect(parseClosingLine(line.replace(' / "h deep"', ""))).toBeNull();
  expect(parseClosingLine("")).toBeNull();
  expect(parseClosingLine("Reply y")).toBeNull();
});

it("maps y in any case with no strategy to keep each file's value", () => {
  expect(parseApproval("y")).toStrictEqual({ kind: "approve", strategy: null });
  expect(parseApproval("Y")).toStrictEqual({ kind: "approve", strategy: null });
});

it("maps a strategy word, ignoring extra spaces", () => {
  expect(parseApproval("y spawn-deep")).toStrictEqual({ kind: "approve", strategy: "spawn-deep" });
  expect(parseApproval("y  default ")).toStrictEqual({ kind: "approve", strategy: "default" });
});

it("names an unknown word", () => {
  expect(parseApproval("y review-medium")).toStrictEqual({ kind: "unknown", word: "review-medium" });
});

it("maps h, h fast and h deep in any case to a handoff", () => {
  expect(parseApproval("h")).toStrictEqual({ kind: "handoff", strategy: null });
  expect(parseApproval("H")).toStrictEqual({ kind: "handoff", strategy: null });
  expect(parseApproval("h fast")).toStrictEqual({ kind: "handoff", strategy: "spawn-fast" });
  expect(parseApproval(" H  Deep ")).toStrictEqual({ kind: "handoff", strategy: "spawn-deep" });
});

it("names an unknown h word", () => {
  expect(parseApproval("h slow")).toStrictEqual({ kind: "unknown", word: "slow" });
  expect(parseApproval("h spawn-fast")).toStrictEqual({ kind: "unknown", word: "spawn-fast" });
  expect(parseApproval("h constructor")).toStrictEqual({ kind: "unknown", word: "constructor" });
});

it("is null for anything that is not a y or h reply", () => {
  for (const p of ["yes please", "", "n", "y spawn-deep now", "ya", "hi", "h fast now", "help"])
    expect(parseApproval(p)).toBeNull();
});
