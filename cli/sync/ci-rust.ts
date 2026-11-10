import { MSRV_JOB, MSRV_STEPS } from "./ci-rust.constants.ts";
import type { SyncContext } from "./outputs.ts";
import { CARGO_PATH } from "./rust.constants.ts";
import { CHECKOUT_STEP, TEST_TIMEOUT_MINUTES } from "./release.constants.ts";

/** Whether the root has a Cargo.toml, which adds the Rust steps and the msrv job. */
export const isRust = (ctx: Pick<SyncContext, "read">): boolean => ctx.read(CARGO_PATH) !== null;

/** The msrv job, which Rust repos add after the other jobs; it needs no bun, only the runner's cargo. */
export const msrvJob = (): string =>
  [
    "  msrv:",
    `    name: ${MSRV_JOB}`,
    "    runs-on: ubuntu-latest",
    `    timeout-minutes: ${TEST_TIMEOUT_MINUTES}`,
    "    steps:",
    CHECKOUT_STEP,
    MSRV_STEPS,
  ].join("\n");
