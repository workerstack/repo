import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, expect, it } from "vitest";

import type { RunResult } from "./run.ts";
import { writeSummary } from "./summary.ts";

const NOW = new Date("2026-11-13T10:06:55.123Z");
const CASES = [{ control: false, fails: 1, id: "a", pass: true, samples: 3 }];
let dir = "";

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "summary-"));
});

afterEach(() => {
  fs.rmSync(dir, { force: true, recursive: true });
});

function runOf(end: RunResult["end"]): RunResult {
  return { cached: 1, calls: 4, cases: CASES, end, spent: 0.5 };
}

function write(end: RunResult["end"], now = NOW): string {
  return writeSummary(dir, { cap: 2, estimate: 1.5, eval: "demo", model: "m", run: runOf(end) }, now);
}

it("names the file from the eval and the UTC clock", () => {
  const file = write({ kind: "done" });

  expect(path.isAbsolute(file)).toBe(true);
  expect(path.basename(file)).toMatch(/^demo-20261113T100655123Z-[0-9a-f]{4}\.json$/);
});

it("makes two files for two writes at one now", () => {
  const first = write({ kind: "done" });
  const second = write({ kind: "done" });

  expect(first).not.toBe(second);
  expect(fs.readdirSync(dir)).toHaveLength(2);
});

it.each([[{ kind: "done" }], [{ kind: "stopped" }], [{ kind: "failed", message: "boom" }]] as const)(
  "writes the fields for %j",
  (end) => {
    const json = JSON.parse(fs.readFileSync(write(end), "utf8"));

    expect(json).toStrictEqual({
      cached: 1,
      calls: 4,
      cap: 2,
      cases: CASES,
      end,
      estimate: 1.5,
      eval: "demo",
      model: "m",
      spent: 0.5,
    });
  },
);
