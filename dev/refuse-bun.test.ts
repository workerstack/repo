import { expect, it } from "vitest";

import { refuseBun } from "./refuse-bun.ts";

it("refuses a run of the node config under Bun and names the command that runs it under Node", () => {
  expect(() => refuseBun({ bun: "1.4.4", node: "24.3.0" })).toThrow(
    "vitest.node.config.ts runs on node; run node --run test:node",
  );
  expect(() => refuseBun({ node: "26.13.0" })).not.toThrow();
});
