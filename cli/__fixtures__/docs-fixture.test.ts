import { expect, it } from "vitest";
import { OK, docsRun, exampleTools, packed } from "./docs-fixture.ts";

it("gives an io whose tools succeed quietly and whose output is collected", async () => {
  const run = docsRun("/x");
  expect(run.io.tools.tsc([], "/x")).toBe(OK);
  expect(run.io.tools.bun([], "/x")).toBe(OK);
  expect(run.io.tools.pack("/x")).toBe(OK);
  run.io.out("a");
  run.io.err("b");
  expect(await run.io.sync("/y")).toBe(0);
  expect([run.out, run.err, run.synced]).toEqual([["a"], ["b"], ["/y"]]);
});

it("answers example tool calls from the answer, recording each", () => {
  const fake = exampleTools();
  expect(fake.tools.tsc(["-p"], "/x")).toEqual(OK);
  expect(fake.calls).toEqual([{ tool: "tsc", args: ["-p"], cwd: "/x" }]);
  expect(packed("a", "b").stdout).toBe("packed 1KB a\npacked 1KB b\n");
});
