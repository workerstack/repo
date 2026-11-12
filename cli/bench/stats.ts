/** Summary statistics of one metric's samples across a candidate's measured runs. */

/** The median, mean, sample (n - 1) standard deviation, CV (stddev over mean; 0 at a zero mean), min and max. */
export type Summary = { median: number; mean: number; stddev: number; cv: number; min: number; max: number };

const HALF = 2;

/** The middle sample, or the mean of the two middle ones; `sorted` is ascending and not empty. */
function middle(sorted: readonly number[]): number {
  const count = sorted.length;
  const pair = sorted.slice(Math.floor((count - 1) / HALF), Math.floor(count / HALF) + 1);
  return pair.reduce((sum, value) => sum + value, 0) / pair.length;
}

/** Summarizes at least one sample; one sample has a zero spread. */
export function summarize(samples: readonly number[]): Summary {
  const count = samples.length;
  const mean = samples.reduce((sum, value) => sum + value, 0) / count;
  const squares = samples.reduce((sum, value) => sum + (value - mean) ** HALF, 0);
  const stddev = count > 1 ? Math.sqrt(squares / (count - 1)) : 0;
  return {
    cv: mean === 0 ? 0 : stddev / mean,
    max: Math.max(...samples),
    mean,
    median: middle(samples.toSorted((a, b) => a - b)),
    min: Math.min(...samples),
    stddev,
  };
}
