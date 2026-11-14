import fs from "node:fs";
import path from "node:path";

import { afterEach, expect, it } from "vitest";

import { edited } from "./__fixtures__/turn-cache-kit.ts";
import { cleanTemps, git, SLOW, write } from "./__fixtures__/turn-repo.ts";
import { DAY } from "./clean.constants.ts";
import { PASS_AGE } from "./pass-cache.constants.ts";
import { passed, type StepResult, type Turn } from "./turn-steps.ts";
import { gateMain, type Gate } from "./turn.ts";

afterEach(cleanTemps);

const runs: string[] = [];

function firstStep(): Promise<StepResult> {
  runs.push("first");

  return Promise.resolve(passed("first ok"));
}

/** Rewrites a gated file, writes a new one, and writes the ignored `.env`, which git lists in no change set. */
function rewriteStep(turned: Turn): Promise<StepResult> {
  runs.push("rewrite");
  write(turned.root, { ".env": "A=1\n", "src/a.ts": "export const a = 3;\n", "src/made.ts": "export const m = 1;\n" });

  return Promise.resolve(passed("rewrite ok", ["src/a.ts", "src/made.ts"]));
}

function lastStep(turned: Turn): Promise<StepResult> {
  runs.push(`last ${turned.changes.map((change) => change.rel).join(" ")}`);

  return Promise.resolve(passed("last ok"));
}

const REWRITING: Gate = {
  name: "turn",
  parse: () => ({ ok: true, scope: { kind: "tree" } }),
  steps: [firstStep, rewriteStep, lastStep],
};

it(
  "a rewrite reruns only the earlier steps next gate, and the files it wrote join the set",
  { timeout: SLOW },
  async () => {
    const root = edited();
    const out: string[] = [];
    const deps = { cwd: root, stderr: () => {}, stdout: (s: string) => out.push(s) };
    expect(await gateMain(REWRITING, [], deps)).toBe(0);
    expect(runs.splice(0)).toStrictEqual(["first", "rewrite", "last src/a.ts src/made.ts"]);
    expect(await gateMain(REWRITING, [], deps)).toBe(0);
    expect(runs.splice(0)).toStrictEqual(["first"]);
    expect(out).toStrictEqual([
      "turn: 1 file · first ok · rewrite ok · last ok\n",
      "turn: 2 files · first ok · 2 cached\n",
    ]);
  },
);

const ONE: Gate = { ...REWRITING, steps: [firstStep] };

/** The steps two runs of `ONE` ran in `root`, each run's list apart. */
async function twice(root: string): Promise<string[][]> {
  const deps = { cwd: root, stderr: () => {}, stdout: () => {} };
  expect(await gateMain(ONE, [], deps)).toBe(0);
  const first = runs.splice(0);
  expect(await gateMain(ONE, [], deps)).toBe(0);

  return [first, runs.splice(0)];
}

it("a repo with no commit and no index caches its passing gate", { timeout: SLOW }, async () => {
  const root = edited();
  git(root, "update-ref", "-d", "HEAD");
  fs.rmSync(path.join(root, ".git/index"));
  expect(await twice(root)).toStrictEqual([["first"], []]);
});

it("a file git cannot read runs every step each gate and records nothing", { timeout: SLOW }, async () => {
  const root = edited();
  write(root, { "notes.bin": "x\n" });
  fs.chmodSync(path.join(root, "notes.bin"), 0);
  expect(await twice(root)).toStrictEqual([["first"], ["first"]]);
  expect(fs.readdirSync(path.join(root, ".repo/tmp/turn"))).toStrictEqual([]);
});

it("a passing gate removes the entries older than a week and keeps the rest", { timeout: SLOW }, async () => {
  const root = edited();
  const dir = path.join(root, ".repo/tmp/turn");
  write(root, { ".repo/tmp/turn/new": "", ".repo/tmp/turn/old": "" });
  const old = new Date(Date.now() - PASS_AGE - DAY);
  fs.utimesSync(path.join(dir, "old"), old, old);
  await twice(root);
  expect(fs.readdirSync(dir)).toContain("new");
  expect(fs.readdirSync(dir)).not.toContain("old");
});
