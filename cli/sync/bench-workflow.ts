import { BENCH_CHECKOUT_WITH, BENCH_PATH, BENCH_PREAMBLE, BENCH_STEPS } from "./bench-workflow.constants.ts";
import { hasOwnedHeader } from "./header.ts";
import type { Generator, SyncContext } from "./outputs.ts";
import { CHECKOUT_STEP, INSTALL_STEP, SETUP_BUN_STEP } from "./release.constants.ts";

/**
 * Under the benchmark pack, the tracked, whole-file `.github/workflows/bench.yml` that `repo bench --remote`
 * dispatches; a hand-written one is refused.
 */
export function benchWorkflow(ctx: SyncContext): ReturnType<Generator> {
  if (!ctx.config.packs.includes("benchmark")) return { errors: [], outputs: [] };
  const existing = ctx.read(BENCH_PATH);

  if (existing !== null && !hasOwnedHeader(existing))
    return { errors: [`${BENCH_PATH} is hand-written; delete it so repo sync can own it`], outputs: [] };
  const steps = [CHECKOUT_STEP, BENCH_CHECKOUT_WITH, SETUP_BUN_STEP, INSTALL_STEP, BENCH_STEPS];
  const content = `${[BENCH_PREAMBLE, ...steps].join("\n")}\n`;

  return { errors: [], outputs: [{ content, kind: "file", managed: "whole", path: BENCH_PATH, tracked: true }] };
}
