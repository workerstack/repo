import { expect, it } from "vitest";

import type { JsonObject } from "../json.ts";
import { parseSpec } from "./parse-spec.ts";
import { defineBench } from "./spec.ts";

const ONE = { candidates: { bun: { run: ["bun", "-e", "1"] } }, metrics: { wall: { weight: 1 } } };

/** The refusals `parseSpec` gives for `ONE` with `change` over it. */
function refusals(change: JsonObject) {
  return parseSpec({ default: { ...ONE, ...change } });
}

const PARSED = {
  candidates: [
    { name: "bun", run: ["bun", "x.ts"], setup: null },
    { name: "node", run: ["node", "x.mjs"], setup: ["bun", "build", "x.ts"] },
  ],
  metrics: [
    { better: "lower", name: "wall", unit: "ms", weight: 2 },
    { better: "lower", name: "cpu", unit: "ms", weight: 1 },
    { better: "higher", name: "ops", unit: "ops/s", weight: 1 },
    { better: "lower", name: "rss", unit: "MB", weight: 1 },
    { better: "lower", name: "heap-mb", unit: "", weight: 0.5 },
  ],
  os: ["macos-latest", "ubuntu-latest"],
  runs: 7,
  warmup: 2,
};

it("returns the spec it is given, so a spec file's default export is the object it wrote", () => {
  const spec = { ...ONE, runs: 5 };
  expect(defineBench(spec)).toBe(spec);
});

it("orders candidates by name and metrics by weight then name, whatever the key order, with built-in units", () => {
  // Built from entries so the keys arrive unsorted: a spec's key order must not change its table.
  const metrics = Object.fromEntries([
    ["heap-mb", { weight: 0.5 }],
    ["rss", { weight: 1 }],
    ["ops", { better: "higher", unit: "ops/s", weight: 1 }],
    ["cpu", { weight: 1 }],
    ["wall", { weight: 2 }],
  ]);

  const node = { run: ["node", "x.mjs"], setup: ["bun", "build", "x.ts"] };

  const candidates = Object.fromEntries<{ run: string[]; setup?: string[] }>([
    ["node", node],
    ["bun", { run: ["bun", "x.ts"] }],
  ]);

  const spec = { candidates, metrics, os: ["macos-latest", "ubuntu-latest"], runs: 7, warmup: 2 };
  expect(parseSpec({ default: spec })).toStrictEqual({ ok: true, spec: PARSED });
});

it("defaults to 10 runs, 1 warmup and no remote os", () => {
  const parsed = parseSpec({ default: ONE });
  expect(parsed.ok && [parsed.spec.runs, parsed.spec.warmup, parsed.spec.os]).toStrictEqual([10, 1, []]);
});

it("takes every os label the runner maps a machine to", () => {
  const os = ["ubuntu-latest", "ubuntu-24.04-arm", "macos-latest", "macos-13", "windows-latest"];
  expect(refusals({ os }).ok).toBe(true);
});

it.each([
  [{ runs: 2 }, "runs: 2 is under 3; a median and CV need at least 3 runs"],
  [{ runs: 4.5 }, "runs: 4.5 is not a whole number"],
  [{ warmup: -1 }, "warmup: -1 is under 0"],
  [
    { os: ["ubuntu-22.04"] },
    'os: "ubuntu-22.04" is not a bench os; use ubuntu-latest, ubuntu-24.04-arm, macos-latest, ' +
      "macos-13 or windows-latest",
  ],
  [{ candidates: {} }, "candidates: none; add at least one"],
  [{ metrics: {} }, "metrics: none; add at least one"],
  [{ candidates: { "Bun!": { run: ["bun"] } } }, 'candidates: "Bun!" is not a name; use a-z, 0-9 and -'],
  [{ metrics: { Ops: { weight: 1 } } }, 'metrics: "Ops" is not a name; use a-z, 0-9 and -'],
  [{ candidates: { bun: { run: [] } } }, "candidates.bun.run: empty; give the command and its args"],
  [{ metrics: { wall: { weight: 0 } } }, "metrics.wall.weight: 0 is not over 0"],
  [{ metrics: { wall: { better: "higher", weight: 1 } } }, "metrics.wall.better: wall is built in and lower is better"],
  [{ metrics: { rss: { unit: "KB", weight: 1 } } }, "metrics.rss.unit: rss is built in and measured in MB"],
  [{ warmups: 1 }, 'Unrecognized key: "warmups"'],
  [{ candidates: { bun: { run: ["bun"], setpu: ["x"] } } }, 'candidates.bun: Unrecognized key: "setpu"'],
])("refuses %j with one line naming the field and the fix", (change, line) => {
  expect(refusals(change)).toStrictEqual({ errors: [line], ok: false });
});

it("refuses every bad field at once", () => {
  const parsed = refusals({ os: ["linux"], runs: 1 });
  expect(parsed.ok ? [] : parsed.errors).toHaveLength(2);
});

it.each([null, 3, "spec", []])("refuses a default export that is not a spec object: %j", (value) => {
  expect(parseSpec({ default: value })).toStrictEqual({
    errors: ["the default export is not a bench spec; export default defineBench({ candidates, metrics })"],
    ok: false,
  });
});
