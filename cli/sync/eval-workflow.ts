import {
  EVAL_KEEP_STEPS,
  EVAL_PATH,
  EVAL_PREAMBLE,
  EVAL_RESTORE_STEP,
  EVAL_RUN_STEP,
} from "./eval-workflow.constants.ts";
import { hasOwnedHeader } from "./header.ts";
import type { Generator, SyncContext } from "./outputs.ts";
import { CHECKOUT_STEP, INSTALL_STEP, SETUP_BUN_STEP } from "./release.constants.ts";

/**
 * Under the evals pack, the tracked, whole-file `.github/workflows/eval.yml` a person dispatches to run one eval in
 * the `evals` environment; a hand-written one is refused.
 */
export function evalWorkflow(ctx: SyncContext): ReturnType<Generator> {
  if (!ctx.config.packs.includes("evals")) return { errors: [], outputs: [] };
  const existing = ctx.read(EVAL_PATH);

  if (existing !== null && !hasOwnedHeader(existing))
    return { errors: [`${EVAL_PATH} is hand-written; delete it so repo sync can own it`], outputs: [] };
  const steps = [CHECKOUT_STEP, SETUP_BUN_STEP, INSTALL_STEP, EVAL_RESTORE_STEP, EVAL_RUN_STEP, EVAL_KEEP_STEPS];
  const content = `${[EVAL_PREAMBLE, ...steps].join("\n")}\n`;

  return { errors: [], outputs: [{ content, kind: "file", managed: "whole", path: EVAL_PATH, tracked: true }] };
}
