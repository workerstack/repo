// A spec the runner refuses: two runs give no CV worth reading.
import { defineBench } from "../../../bench/spec.ts";

export default defineBench({ candidates: { bun: { run: ["bun", "-e", "1"] } }, metrics: { wall: { weight: 1 } }, runs: 2 });
