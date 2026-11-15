import { afterEach, expect, it } from "vitest";

import { deferred, gateOf, runGate, step, within } from "./__fixtures__/gate-kit.ts";
import { edited } from "./__fixtures__/turn-cache-kit.ts";
import { cleanTemps, read, SLOW, write } from "./__fixtures__/turn-repo.ts";
import { failed, passed, type Turn } from "./turn-steps.ts";

afterEach(cleanTemps);

const OLD = "export const a = 2;\n";
const NEW = "export const a = 3;\n";

/** True when `turn` gates `rel`. */
function gates(turn: Turn, rel: string): boolean {
  return turn.changes.some((change) => change.rel === rel);
}

it("runs a later fix beside the write and beside steps", { timeout: SLOW }, async () => {
  const started = deferred();
  const beside = step("b", () => (started.resolve(), passed("b ok")));
  const lint = step("l", async () => (await within(started.promise, "the beside step"), passed("l ok")));
  const run = await runGate(gateOf({ beside: [beside], fixes: [step("f"), lint], writes: [step("w")] }), edited());
  expect(run.out).toBe("turn: 1 file · f ok · l ok · w ok · b ok\n");
});

it("starts the beside steps once the write steps ended", { timeout: SLOW }, async () => {
  const slow = step("w", async () => (await new Promise((settle) => setTimeout(settle, 50)), passed("w ok")));
  const run = await runGate(gateOf({ beside: [step("b")], fixes: [step("f")], writes: [slow] }), edited());
  expect(run.log).toStrictEqual(["f src/a.ts", "w src/a.ts", "b src/a.ts"]);
});

it("reruns a beside step on the text a later fix left", { timeout: SLOW }, async () => {
  const started = deferred();

  const reader = step(
    "b",
    (turn) => (started.resolve(), read(turn.root, "src/a.ts") === OLD ? failed("b failed", []) : passed("b ok")),
  );

  const lint = step("l", async (turn) => {
    if (gates(turn, "src/b.ts")) return passed("l ok");
    await within(started.promise, "the beside step");
    write(turn.root, { "src/a.ts": NEW, "src/b.ts": NEW });

    return passed("l 2 fixed", ["src/a.ts", "src/b.ts"]);
  });

  const run = await runGate(gateOf({ beside: [reader], fixes: [step("f"), lint] }), edited());
  expect(run).toMatchObject({ code: 0, err: [], out: "turn: 1 file · f ok · l 2 fixed · b ok\n" });
  expect(run.log).toStrictEqual([
    "f src/a.ts",
    "l src/a.ts",
    "b src/a.ts",
    "f src/b.ts",
    "l src/b.ts",
    "b src/a.ts src/b.ts",
  ]);
});

it("runs the write steps again when a later fix rewrote a file", { timeout: SLOW }, async () => {
  const lint = step("l", (turn) => (write(turn.root, { "src/a.ts": NEW }), passed("l 1 fixed", ["src/a.ts"])));
  const run = await runGate(gateOf({ fixes: [step("f"), lint], writes: [step("w")] }), edited());
  expect(run.log.filter((line) => line.startsWith("w "))).toStrictEqual(["w src/a.ts", "w src/a.ts"]);
  expect(run.out).toBe("turn: 1 file · f ok · l 1 fixed · w ok\n");
});

it("runs each step once when no later fix rewrites a file", { timeout: SLOW }, async () => {
  const gate = gateOf({ beside: [step("b"), step("c")], fixes: [step("f"), step("l")], writes: [step("w")] });
  const run = await runGate(gate, edited());
  expect(run.log.toSorted()).toStrictEqual(["b src/a.ts", "c src/a.ts", "f src/a.ts", "l src/a.ts", "w src/a.ts"]);
  expect(run.out).toBe("turn: 1 file · f ok · l ok · w ok · b ok · c ok\n");
});

it("starts a rerun only once the first run ended", { timeout: SLOW }, async () => {
  const wrote = deferred();
  const order: string[] = [];
  let runs = 0;

  const slow = step("b", async () => {
    runs += 1;
    const at = runs;
    order.push(`start ${at}`);

    if (at === 1) await wrote.promise;
    await new Promise((settle) => setTimeout(settle, 50));
    order.push(`end ${at}`);

    return passed("b ok");
  });

  const lint = step(
    "l",
    (turn) => (write(turn.root, { "src/a.ts": NEW }), wrote.resolve(), passed("l ok", ["src/a.ts"])),
  );

  await runGate(gateOf({ beside: [slow], fixes: [step("f"), lint] }), edited());
  expect(order).toStrictEqual(["start 1", "end 1", "start 2", "end 2"]);
});

it("prints a beside step's output after a later fix's output", { timeout: SLOW }, async () => {
  const done = deferred();
  const beside = step("b", () => (done.resolve(), failed("b failed", ["B\n"])));
  const late = step("l", async () => (await done.promise, failed("l failed", ["L\n"])));
  const run = await runGate(gateOf({ beside: [beside], fixes: [step("f"), late] }), edited());
  expect(run).toMatchObject({ code: 1, err: ["L\n", "B\n"], out: "turn: 1 file · f ok · l failed · b failed\n" });
});

it("drops the beside results when a later fix returns every change to the base", { timeout: SLOW }, async () => {
  const revert = step(
    "l",
    (turn) => (write(turn.root, { "src/a.ts": "export const a = 1;\n" }), passed("l ok", ["src/a.ts"])),
  );

  const beside = step("b", () => failed("b failed", ["B\n"]));
  const run = await runGate(gateOf({ beside: [beside], fixes: [step("f"), revert] }), edited());
  expect(run).toMatchObject({ code: 0, err: [], out: "turn: 1 file · f ok · l ok · no changes left\n" });
});

it("runs the after steps at once, after the write steps", { timeout: SLOW }, async () => {
  const started = deferred();
  const first = step("x", async () => (await within(started.promise, "the second after step"), passed("x ok")));
  const second = step("y", () => (started.resolve(), passed("y ok")));
  const run = await runGate(gateOf({ after: [first, second], writes: [step("w")] }), edited());
  expect(run.log).toStrictEqual(["w src/a.ts", "x src/a.ts", "y src/a.ts"]);
  expect(run.out).toBe("turn: 1 file · w ok · x ok · y ok\n");
});
