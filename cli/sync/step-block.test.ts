import { describe, expect, it } from "vitest";

import type { MigrationStep } from "./migrate.ts";
import { type StepRun, stepBlock } from "./step-block.ts";

const NOTE: MigrationStep = { kind: "note", note: "do it by hand" };
const CONFLICT: MigrationStep = { from: "a", kind: "conflict", line: "repo sync: cannot move a", to: "b" };

/** A run that records what the block asked of it; `replanned` holds each replan's reload flag. */
function fakeRun(over: Partial<StepRun> = {}) {
  const err: string[] = [];
  const applied: (readonly MigrationStep[])[] = [];
  const replanned: boolean[] = [];

  const run: StepRun = {
    apply: (steps) => {
      applied.push(steps);

      return Promise.resolve();
    },
    check: false,
    fail: (errors) => {
      err.push(...errors.map((error) => `failed: ${error}`));

      return 1;
    },
    postinstall: false,
    replan: (reload) => {
      replanned.push(reload);

      return Promise.resolve(null);
    },
    stderr: (s) => err.push(s),
    ...over,
  };

  return { applied, err, replanned, run };
}

describe("stepBlock stops", () => {
  it("does nothing for no steps", async () => {
    const { run, err, applied, replanned } = fakeRun();
    expect(await stepBlock({ noun: "adoption", steps: [] }, run)).toStrictEqual({ applied: false });
    expect([err, applied, replanned]).toStrictEqual([[], [], []]);
  });

  it("prints conflicts and stops before applying anything", async () => {
    const { run, err, applied } = fakeRun();
    expect(await stepBlock({ noun: "migration", steps: [NOTE, CONFLICT] }, run)).toStrictEqual({ exit: 1 });
    expect(err).toStrictEqual(["repo sync: cannot move a\n"]);
    expect(applied).toStrictEqual([]);
  });

  it("exits 0 on a conflict under --postinstall", async () => {
    const { run } = fakeRun({ postinstall: true });
    expect(await stepBlock({ noun: "migration", steps: [CONFLICT] }, run)).toStrictEqual({ exit: 0 });
  });
});

describe("stepBlock under --check", () => {
  it("reports one pending step under --check in its own words", async () => {
    const { run, err, applied } = fakeRun({ check: true });
    expect(await stepBlock({ noun: "handover", steps: [NOTE] }, run)).toStrictEqual({ exit: 1 });
    expect(err).toStrictEqual(["repo sync: 1 handover step pending; run `bun repo sync`\n"]);
    expect(applied).toStrictEqual([]);
  });

  it("names each pending step that says what it would do, before the count", async () => {
    const { run, err } = fakeRun({ check: true });

    const move: MigrationStep = {
      kind: "handover",
      note: "moved a",
      pending: "would move a",
      remove: ["a"],
      writes: [],
    };

    expect(await stepBlock({ noun: "handover", steps: [move, NOTE] }, run)).toStrictEqual({ exit: 1 });
    expect(err).toStrictEqual([
      "repo sync: would move a\n",
      "repo sync: 2 handover steps pending; run `bun repo sync`\n",
    ]);
  });

  it("counts several pending steps in the plural", async () => {
    const { run, err } = fakeRun({ check: true });
    expect(await stepBlock({ noun: "adoption", steps: [NOTE, NOTE] }, run)).toStrictEqual({ exit: 1 });
    expect(err).toStrictEqual(["repo sync: 2 adoption steps pending; run `bun repo sync`\n"]);
  });
});

describe("stepBlock applies", () => {
  it("applies the steps, then plans again without a reload by default", async () => {
    const { run, applied, replanned } = fakeRun();
    expect(await stepBlock({ noun: "adoption", steps: [NOTE] }, run)).toStrictEqual({ applied: true });
    expect(applied).toStrictEqual([[NOTE]]);
    expect(replanned).toStrictEqual([false]);
  });

  it("reloads the config before planning again when the block asks", async () => {
    const { run, replanned } = fakeRun();
    expect(await stepBlock({ noun: "migration", reload: true, steps: [NOTE] }, run)).toStrictEqual({ applied: true });
    expect(replanned).toStrictEqual([true]);
  });

  it("fails with the message of a step that throws and plans nothing", async () => {
    const { run, err, replanned } = fakeRun({ apply: () => Promise.reject(new Error("disk full")) });
    expect(await stepBlock({ noun: "migration", steps: [NOTE] }, run)).toStrictEqual({ exit: 1 });
    expect(err).toStrictEqual(["failed: disk full"]);
    expect(replanned).toStrictEqual([]);
  });

  it("stops with the exit of a plan that fails after the steps", async () => {
    const { run } = fakeRun({ replan: () => Promise.resolve(2) });
    expect(await stepBlock({ noun: "adoption", steps: [NOTE] }, run)).toStrictEqual({ exit: 2 });
  });
});
