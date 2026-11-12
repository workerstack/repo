// The Usage spec: two `bun -e` candidates, one with a setup, scored on wall, rss and a custom higher-is-better ops.
import { defineBench } from "../../../bench/spec.ts";

export default defineBench({
  candidates: {
    bun: { run: ["bun", "-e", "1"] },
    node: { run: ["bun", "-e", "2"], setup: ["bun", "-e", "0"] },
  },
  metrics: { ops: { better: "higher", unit: "ops/s", weight: 1 }, rss: { weight: 1 }, wall: { weight: 2 } },
  runs: 10,
  warmup: 1,
  os: ["ubuntu-latest", "macos-latest", "windows-latest"],
});
