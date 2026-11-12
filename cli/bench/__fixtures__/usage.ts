// The Usage example's samples and the table text they must print, shared by the score and `repo bench` tests.

/** Ten measured runs per candidate and metric; medians 41.2/88 ms wall, 48.1/61.3 MB rss, 9120/7010 ops. */
export const SAMPLES = {
  bun: {
    wall: [39, 40.6, 40.8, 41, 41.2, 41.2, 41.4, 41.6, 42, 45],
    rss: [47, 47.5, 47.8, 48, 48.1, 48.1, 48.3, 48.5, 48.8, 49],
    ops: [8700, 8800, 8900, 9000, 9120, 9120, 9200, 9300, 9400, 9500],
  },
  node: {
    wall: [76, 77, 79, 84, 88, 88, 92, 97, 103, 104],
    rss: [60, 60.5, 61, 61.2, 61.3, 61.3, 61.6, 62, 62.5, 63],
    ops: [6600, 6650, 6800, 6900, 7010, 7010, 7100, 7200, 7350, 7400],
  },
} as const;

export const METRICS = [
  { name: "wall", weight: 2, better: "lower", unit: "ms" },
  { name: "rss", weight: 1, better: "lower", unit: "MB" },
  { name: "ops", weight: 1, better: "higher", unit: "ops/s" },
] as const;

export const SHA = "82c0e43aa1b2c3d4e5f60718293a4b5c6d7e8f90";

/** The Linux machine of the Usage header. */
export const LINUX = {
  label: "ubuntu-latest",
  platform: "linux",
  arch: "x64",
  cpu: "AMD Ryzen 9 7950X",
  cores: 32,
  memoryBytes: 64 * 1024 ** 3,
  bun: "1.3.2",
  sha: SHA,
  dirty: true,
  /** No floor, so the Usage table has no `~`; a floor is set per test. */
  rssFloorBytes: null,
} as const;

export const HEADER =
  "startup · ubuntu-latest (linux x64) · AMD Ryzen 9 7950X (32) · 64 GB · bun 1.3.2 · 82c0e43+dirty · 10 runs, 1 warmup";

/**
 * The rows under the header. Score: node = (2 × 41.2/88 + 48.1/61.3 + 7010/9120) / 4 × 100 = 62.24 → 62. CVs (sample
 * stddev over mean): bun wall 3.6%, node wall 11.5% (over 10%, so flagged), rss 1.2% and 1.5%, ops 2.8% and 3.9%.
 * Metric columns go by weight, heaviest first, then by name; rows by score, best first, then by name. Columns are two
 * spaces apart and padded to their widest cell; score is right-aligned; lines carry no trailing space.
 */
export const ROWS = [
  "candidate  score  wall ms (×2)       ops ops/s (×1)      rss MB (×1)",
  "bun          100  41.2 ±4% 39–45     9120 ±3% 8700–9500  48.1 ±1% 47–49",
  "node          62  88.0 ±11%! 76–104  7010 ±4% 6600–7400  61.3 ±1% 60–63",
  "! node wall: CV 11% over 10%; rerun with more runs or a quieter machine (load from other work counts)",
].join("\n");

/** The whole table for `LINUX`: header, rows and the flag line, newline-terminated. */
export const TABLE = `${HEADER}\n${ROWS}\n`;
