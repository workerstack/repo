import fs from "node:fs";
import path from "node:path";

import { afterEach, expect, it } from "vitest";

import { gateOf, runGate, step } from "./__fixtures__/gate-kit.ts";
import { edited } from "./__fixtures__/turn-cache-kit.ts";
import { cleanTemps, SLOW, write } from "./__fixtures__/turn-repo.ts";
import { failed, passed, type Turn } from "./turn-steps.ts";

afterEach(cleanTemps);

/** A write step that adds `made.json`. */
const made = step("stock", (turn) => (write(turn.root, { "made.json": "{}\n" }), passed("stock ok", ["made.json"])));

function gatesMade(turn: Turn): boolean {
  return turn.changes.some((change) => change.rel === "made.json");
}

it(
  "a fix that failed on the first files stays failed when it passes on the joined one",
  { timeout: SLOW },
  async () => {
    const fmt = step("fmt", (turn) => (gatesMade(turn) ? passed("fmt ok") : failed("fmt failed", ["F\n"])));
    const run = await runGate(gateOf({ fixes: [fmt], writes: [made] }), edited());
    expect(run).toMatchObject({ code: 1, err: ["F\n"], out: "turn: 1 file · fmt failed · stock ok\n" });
  },
);

it("a fix that failed on both runs keeps the first label and prints both outputs", { timeout: SLOW }, async () => {
  const fmt = step("fmt", (turn) =>
    failed(gatesMade(turn) ? "fmt joined failed" : "fmt failed", [gatesMade(turn) ? "J\n" : "F\n"]),
  );

  const run = await runGate(gateOf({ fixes: [fmt], writes: [made] }), edited());
  expect(run).toMatchObject({ code: 1, err: ["F\n", "J\n"], out: "turn: 1 file · fmt failed · stock ok\n" });
});

it("a fix that passed on the first files fails when it fails on the joined one", { timeout: SLOW }, async () => {
  const fmt = step("fmt", (turn) => (gatesMade(turn) ? failed("fmt failed", ["J\n"]) : passed("fmt ok")));
  const run = await runGate(gateOf({ fixes: [fmt], writes: [made] }), edited());
  expect(run).toMatchObject({ code: 1, err: ["J\n"], out: "turn: 1 file · fmt failed · stock ok\n" });
});

it("a fix cached on the first files shows its joined run", { timeout: SLOW }, async () => {
  const root = edited();
  const fmt = step("fmt");
  await runGate(gateOf({ fixes: [fmt] }), root);
  const run = await runGate(gateOf({ fixes: [fmt], writes: [made] }), root);
  expect(run).toMatchObject({
    code: 0,
    log: ["stock src/a.ts", "fmt made.json"],
    out: "turn: 1 file · fmt ok · stock ok\n",
  });
});

it("a fix that rewrote only the joined file shows that run's label", { timeout: SLOW }, async () => {
  const fmt = step("fmt", (turn) => (gatesMade(turn) ? passed("fmt 1 fixed", ["made.json"]) : passed("fmt ok")));
  const run = await runGate(gateOf({ fixes: [fmt], writes: [made] }), edited());
  expect(run).toMatchObject({ code: 0, out: "turn: 1 file · fmt 1 fixed · stock ok\n" });
});

it("a fix with nothing to do on the joined file keeps its first result", { timeout: SLOW }, async () => {
  const fmt = step("fmt", (turn) => (gatesMade(turn) ? null : passed("fmt ok")));
  const run = await runGate(gateOf({ fixes: [fmt], writes: [made] }), edited());
  expect(run).toMatchObject({ code: 0, out: "turn: 1 file · fmt ok · stock ok\n" });
});

it("a fix that returns every file to the base on the joined run ends the gate", { timeout: SLOW }, async () => {
  const fmt = step("fmt", (turn) => {
    if (!gatesMade(turn)) return passed("fmt ok");
    write(turn.root, { "src/a.ts": "export const a = 1;\n" });
    fs.rmSync(path.join(turn.root, "made.json"));

    return passed("fmt 2 fixed", ["src/a.ts", "made.json"]);
  });

  const run = await runGate(
    gateOf({ after: [step("c")], beside: [step("b")], fixes: [fmt, step("lint")], writes: [made] }),
    edited(),
  );

  expect(run).toMatchObject({
    code: 0,
    log: ["fmt src/a.ts", "stock src/a.ts", "lint src/a.ts", "b made.json src/a.ts", "fmt made.json"],
    out: "turn: 1 file · fmt 2 fixed · lint ok · stock ok · no changes left\n",
  });
});
