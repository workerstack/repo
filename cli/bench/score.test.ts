import { expect, it } from "vitest";

import { LINUX, METRICS, SAMPLES, TABLE } from "./__fixtures__/usage.ts";
import type { Metric } from "./parse-spec.ts";
import { renderTable, scores } from "./score.ts";

function lower(name: string, unit: string, weight = 1) {
  return { better: "lower", name, unit, weight } as const;
}
function higher(name: string, unit: string, weight = 1) {
  return { better: "higher", name, unit, weight } as const;
}

/** A result of `runs` samples per candidate and metric, on the Usage machine. */
function result(
  candidates: { name: string; samples: Record<string, readonly number[]> }[],
  metrics: readonly Metric[] = METRICS,
) {
  return { candidates, env: LINUX, metrics, runs: 10, spec: "startup", warmup: 1 };
}

it("gives the best candidate 100 and the rest the weighted mean of best/value per median, × 100", () => {
  const got = scores(METRICS, {
    bun: { ops: 9120, rss: 48.1, wall: 41.2 },
    node: { ops: 7010, rss: 61.3, wall: 88 },
  });
  expect(got.bun).toBe(100);
  // (2 × 41.2/88 + 48.1/61.3 + 7010/9120) / 4 × 100
  expect(got.node).toBeCloseTo(62.2417, 3);
});

it("weighs a metric by its weight", () => {
  const metrics = [lower("wall", "ms", 3), lower("rss", "MB", 1)];
  const got = scores(metrics, { a: { rss: 20, wall: 10 }, b: { rss: 10, wall: 20 } });
  // a: (3 × 1 + 1 × 0.5) / 4; b: (3 × 0.5 + 1 × 1) / 4
  expect(got).toStrictEqual({ a: 87.5, b: 62.5 });
});

it("floors a zero wall median at 0.1 ms, so the zero is best and nothing divides by it", () => {
  expect(scores([lower("wall", "ms")], { a: { wall: 0 }, b: { wall: 0.2 } })).toStrictEqual({ a: 100, b: 50 });
  expect(scores([lower("wall", "ms")], { a: { wall: 0 }, b: { wall: 0 } })).toStrictEqual({ a: 100, b: 100 });
});

it("floors cpu at 1 ms and rss at 1 MB", () => {
  expect(scores([lower("cpu", "ms")], { a: { cpu: 0.5 }, b: { cpu: 2 } })).toStrictEqual({ a: 100, b: 50 });
  expect(scores([lower("rss", "MB")], { a: { rss: 0 }, b: { rss: 4 } })).toStrictEqual({ a: 100, b: 25 });
});

it("floors a custom metric at 1e-6, lower or higher is better", () => {
  expect(scores([lower("errors", "")], { a: { errors: 0 }, b: { errors: 2e-6 } })).toStrictEqual({ a: 100, b: 50 });
  const got = scores([higher("ops", "ops/s")], { a: { ops: 0 }, b: { ops: 5 } });
  expect(got.b).toBe(100);
  expect(got.a).toBeCloseTo(2e-5, 10);
});

it("scores higher-is-better metrics as value/best", () => {
  expect(scores([higher("ops", "ops/s")], { a: { ops: 50 }, b: { ops: 200 } })).toStrictEqual({ a: 25, b: 100 });
});

it("prints the Usage table: header, median ±CV min–max per metric, and a flag line for a CV over 10%", () => {
  const candidates = Object.entries(SAMPLES).map(([name, samples]) => ({ name, samples }));
  expect(renderTable(result(candidates))).toBe(TABLE);
});

it("orders rows by score, best first, whatever the declared order", () => {
  const text = renderTable(
    result([
      { name: "node", samples: SAMPLES.node },
      { name: "bun", samples: SAMPLES.bun },
    ]),
  );
  expect(text).toBe(TABLE);
});

it("orders metric columns by weight, heaviest first, whatever the order they arrive in", () => {
  const candidates = Object.entries(SAMPLES).map(([name, samples]) => ({ name, samples }));
  expect(renderTable(result(candidates, [METRICS[2], METRICS[1], METRICS[0]]))).toBe(TABLE);
});

it("breaks a score tie by candidate name and a weight tie by metric name", () => {
  const metrics = [lower("wall", "ms"), lower("cpu", "ms")];
  const same = { cpu: [1, 1, 1], wall: [1, 1, 1] };
  const text = renderTable(
    result(
      [
        { name: "b", samples: same },
        { name: "a", samples: same },
      ],
      metrics,
    ),
  );
  expect(text.split("\n").slice(1, 4)).toStrictEqual([
    "candidate  score  cpu ms (×1)       wall ms (×1)",
    "a            100  1.00 ±0% 1.0–1.0  1.00 ±0% 1.0–1.0",
    "b            100  1.00 ±0% 1.0–1.0  1.00 ±0% 1.0–1.0",
  ]);
});

it("prints no flag line when every CV is 10% or under, and no unit when a metric has none", () => {
  const metrics = [higher("ops", "")];
  const text = renderTable(result([{ name: "a", samples: { ops: [90, 100, 110] } }], metrics));
  expect(text.split("\n").slice(1)).toStrictEqual([
    "candidate  score  ops (×1)",
    "a            100  100 ±10% 90–110",
    "",
  ]);
});

it("shows a clean tree without +dirty and small values with two significant digits for min and max", () => {
  const env = { ...LINUX, dirty: false };
  const text = renderTable({
    ...result([{ name: "a", samples: { wall: [0.05, 0.06, 0.07] } }], [lower("wall", "ms")]),
    env,
  });
  expect(text).toBe(
    [
      "startup · ubuntu-latest (linux x64) · AMD Ryzen 9 7950X (32) · 64 GB · bun 1.3.2 · 82c0e43 · 10 runs, 1 warmup",
      "candidate  score  wall ms (×1)",
      "a            100  0.0600 ±17%! 0.050–0.070",
      "! a wall: CV 17% over 10%; rerun with more runs or a quieter machine (load from other work counts)",
      "",
    ].join("\n"),
  );
});

const FLOOR = 50 * 1024 ** 2;
const FLOOR_LINE =
  "~ bun rss: 50.0 MB is this runner's own peak on linux, which a child's count starts from; " +
  "its real peak is at most that";

it("flags an rss median within 5% of the runner's own peak with ~ and says what the number is", () => {
  const candidates = Object.entries(SAMPLES).map(([name, samples]) => ({ name, samples }));
  const text = renderTable({ ...result(candidates), env: { ...LINUX, rssFloorBytes: FLOOR } });
  expect(text.split("\n").slice(2)).toStrictEqual([
    "bun          100  41.2 ±4% 39–45     9120 ±3% 8700–9500  48.1 ±1%~ 47–49",
    "node          62  88.0 ±11%! 76–104  7010 ±4% 6600–7400  61.3 ±1% 60–63",
    "! node wall: CV 11% over 10%; rerun with more runs or a quieter machine (load from other work counts)",
    FLOOR_LINE,
    "",
  ]);
});

it("puts ~ after ! when a floored rss cell is also noisy", () => {
  const metrics = [lower("rss", "MB")];
  const env = { ...LINUX, rssFloorBytes: FLOOR };
  const text = renderTable({ ...result([{ name: "bun", samples: { rss: [40, 50, 60] } }], metrics), env });
  expect(text.split("\n").slice(2)).toStrictEqual([
    "bun          100  50.0 ±20%!~ 40–60",
    "! bun rss: CV 20% over 10%; rerun with more runs or a quieter machine (load from other work counts)",
    FLOOR_LINE,
    "",
  ]);
});

it("flags nothing when the floor is unknown or no metric is rss", () => {
  const candidates = Object.entries(SAMPLES).map(([name, samples]) => ({ name, samples }));
  expect(renderTable({ ...result(candidates), env: { ...LINUX, rssFloorBytes: null } })).toBe(TABLE);
  const wallOnly = result([{ name: "bun", samples: { wall: [41, 41, 41] } }], [lower("wall", "ms")]);
  expect(renderTable({ ...wallOnly, env: { ...LINUX, rssFloorBytes: 1e12 } })).not.toContain("~");
});
