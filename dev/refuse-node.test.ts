import { expect, it } from "vitest";

import { refuseNode } from "./refuse-node.ts";

it("refuses a run under Node and names the command that runs the tests under Bun", () => {
  expect(() => refuseNode({ node: "22.0.0" })).toThrow(
    "the tests need the Bun runtime, and vitest is running under Node; run `bun run test` (bun --bun vitest run)",
  );
});

it("lets a run under Bun go on", () => {
  expect(() => refuseNode({ bun: "1.4.4", node: "22.0.0" })).not.toThrow();
});
