import fs from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { BUDGET, HERE, LEDGER, MAIN, contextTree, mainOf, mainWith } from "./__fixtures__/context-tree.ts";
import { removePlanted } from "./__fixtures__/planted-repo.ts";
import { parseContextFlags, writeContext } from "./check-context.ts";

afterEach(removePlanted);

function wrote(added: number) {
  return { message: `context-budget.json written; .repo/context-growth.jsonl +${added} line(s)`, ok: true };
}

function read(dir: string, rel: string): string {
  return fs.readFileSync(path.join(dir, rel), "utf8");
}

describe("parseContextFlags", () => {
  it("reads --write and the text after --reason", () => {
    expect(parseContextFlags(["--write", "--reason", "add the eval skill"])).toStrictEqual({
      reason: "add the eval skill",
      write: true,
    });
  });

  it("reads no reason from none, or from a --reason with nothing after it", () => {
    expect(parseContextFlags([])).toStrictEqual({ reason: undefined, write: false });
    expect(parseContextFlags(["--reason"])).toStrictEqual({ reason: undefined, write: false });
  });
});

describe("writeContext, a rise", () => {
  it("writes the budget one key per line and records the rise with its reason", () => {
    const dir = contextTree(HERE);

    expect(writeContext(dir, { reason: "add the eval skill", write: true }, mainWith(MAIN))).toStrictEqual(wrote(1));
    expect(read(dir, BUDGET)).toBe('{\n  "index": 300,\n  "rules": 6100,\n  "skills": 200\n}\n');
    expect(read(dir, LEDGER)).toBe('{"bucket":"rules","from":5739,"to":6100,"reason":"add the eval skill"}\n');
  });

  it("refuses a rise with no reason and writes nothing", () => {
    const dir = contextTree(HERE);
    const done = writeContext(dir, { reason: undefined, write: true }, mainWith(MAIN));

    expect(done).toStrictEqual({
      message: "--reason is required for a rise over main (rules 5739 -> 6100)",
      ok: false,
    });
    expect(fs.existsSync(path.join(dir, BUDGET))).toBe(false);
  });

  it("appends to an existing ledger and does not repeat a line it holds", () => {
    const dir = contextTree(HERE, { [LEDGER]: '{"bucket":"index","from":1,"to":2,"reason":"old"}\n' });
    const flags = { reason: "r", write: true };
    writeContext(dir, flags, mainWith(MAIN));

    expect(writeContext(dir, flags, mainWith(MAIN))).toStrictEqual(wrote(0));
    expect(read(dir, LEDGER).split("\n").filter(Boolean)).toHaveLength(2);
  });
});

describe("writeContext, no rise", () => {
  const cases = [
    ["a drop", mainWith({ ...HERE, rules: 9999 })],
    ["a file main lacks", mainOf({})],
    ["no main ref", null],
  ] as const;

  it.each(cases)("needs no reason for %s, and writes no ledger", (_name, main) => {
    const dir = contextTree(HERE);

    expect(writeContext(dir, { reason: undefined, write: true }, main).ok).toBe(true);
    expect(fs.existsSync(path.join(dir, LEDGER))).toBe(false);
  });

  it("finds main through git when no reader is given", () => {
    expect(writeContext(contextTree(HERE), { reason: undefined, write: true }).ok).toBe(true);
  });
});
