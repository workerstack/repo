import { expect, it } from "vitest";

import { summarize } from "./stats.ts";

it("gives the middle sample as the median of an odd count, whatever the order", () => {
  expect(summarize([3, 1, 2])).toStrictEqual({ cv: 0.5, max: 3, mean: 2, median: 2, min: 1, stddev: 1 });
});

it("averages the two middle samples of an even count and uses the sample (n - 1) standard deviation", () => {
  const summary = summarize([4, 1, 3, 2]);
  expect(summary).toMatchObject({ max: 4, mean: 2.5, median: 2.5, min: 1 });
  // sqrt(((1.5)^2 + (0.5)^2 + (0.5)^2 + (1.5)^2) / 3) = sqrt(5 / 3)
  expect(summary.stddev).toBeCloseTo(1.290_994, 6);
  expect(summary.cv).toBeCloseTo(0.516_398, 6);
});

it("is the median of a skewed run, not its mean", () => {
  expect(summarize([10, 11, 12, 13, 100]).median).toBe(12);
});

it("gives a zero CV, not NaN, to identical samples and to all-zero samples", () => {
  expect(summarize([5, 5, 5])).toStrictEqual({ cv: 0, max: 5, mean: 5, median: 5, min: 5, stddev: 0 });
  expect(summarize([0, 0, 0])).toStrictEqual({ cv: 0, max: 0, mean: 0, median: 0, min: 0, stddev: 0 });
});

it("gives one sample a zero spread", () => {
  expect(summarize([7])).toStrictEqual({ cv: 0, max: 7, mean: 7, median: 7, min: 7, stddev: 0 });
});
