// A spec measured only on macOS, so a Linux `--remote` runs nothing locally.
import { defineBench } from "../../../bench/spec.ts";

export default defineBench({
  candidates: { bun: { run: ["bun", "-e", "1"] } },
  metrics: { wall: { weight: 1 } },
  runs: 3,
  warmup: 0,
  os: ["macos-latest"],
});
