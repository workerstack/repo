import fs from "node:fs";
import path from "node:path";

import { afterEach, expect, it } from "vitest";

import { deferred, gateOf, runGate, step } from "./__fixtures__/gate-kit.ts";
import { edited } from "./__fixtures__/turn-cache-kit.ts";
import { cleanTemps, git, read, SLOW, write } from "./__fixtures__/turn-repo.ts";
import { passed } from "./turn-steps.ts";

afterEach(cleanTemps);

const NEW = "export const a = 3;\n";

it(
  "runs fmt and lint on a file a later write step added, so the next gate runs no step",
  { timeout: SLOW },
  async () => {
    const made = step(
      "stock",
      (turn) => (write(turn.root, { "made.json": "{}\n" }), passed("stock ok", ["made.json"])),
    );

    const gate = gateOf({ beside: [step("b")], fixes: [step("fmt"), step("lint")], writes: [made] });
    const root = edited();
    const first = await runGate(gate, root);
    expect(first.log).toStrictEqual([
      "fmt src/a.ts",
      "stock src/a.ts",
      "lint src/a.ts",
      "b made.json src/a.ts",
      "fmt made.json",
      "lint made.json",
    ]);
    const second = await runGate(gate, root);
    expect(second).toMatchObject({ code: 0, log: [], out: "turn: 2 files · 4 cached\n" });
  },
);

it("reruns a cached beside step when a write step changed its key", { timeout: SLOW }, async () => {
  const root = edited();
  await runGate(gateOf({ beside: [step("b")] }), root);
  const rewrite = step("w", (turn) => (write(turn.root, { "src/a.ts": NEW }), passed("w ok", ["src/a.ts"])));
  const second = await runGate(gateOf({ beside: [step("b")], writes: [rewrite] }), root);
  expect(second.log).toStrictEqual(["w src/a.ts", "b src/a.ts"]);
  expect(second.out).toBe("turn: 1 file · w ok · b ok\n");
});

// chmod 0 leaves a file readable on win32, so git reads it there.
it.skipIf(process.platform === "win32")("reruns a beside step when no key can be had", { timeout: SLOW }, async () => {
  const root = edited();
  write(root, { "notes.bin": "x\n" });
  fs.chmodSync(path.join(root, "notes.bin"), 0);
  const run = await runGate(gateOf({ beside: [step("b")], writes: [step("w")] }), root);
  expect(run.log).toStrictEqual(["w notes.bin src/a.ts", "b notes.bin src/a.ts", "b notes.bin src/a.ts"]);
});

it("restages a write step's rewrite under precommit while a beside step runs", { timeout: SLOW }, async () => {
  const root = edited();
  git(root, "add", "src/a.ts");
  const wrote = deferred();

  const rewrite = step("w", (turn) => {
    write(turn.root, { "src/a.ts": NEW });
    wrote.resolve();

    return passed("w ok", ["src/a.ts"]);
  });

  const beside = step("b", async () => (await wrote.promise, passed("b ok")));
  const run = await runGate(gateOf({ beside: [beside], writes: [rewrite] }, "precommit"), root);
  expect(run.code).toBe(0);
  expect(git(root, "show", ":src/a.ts")).toBe(NEW);
  expect(read(root, "src/a.ts")).toBe(NEW);
});
