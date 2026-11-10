import { MSRV_JOB, MSRV_STEPS, SEMVER_JOB, SEMVER_STEPS } from "./ci-rust.constants.ts";
import type { SyncContext } from "./outputs.ts";
import { CARGO_PATH } from "./rust.constants.ts";
import {
  CHECKOUT_FULL_STEP,
  CHECKOUT_STEP,
  INSTALL_STEP,
  SETUP_BUN_STEP,
  TEST_TIMEOUT_MINUTES,
} from "./release.constants.ts";

/** Whether the root has a Cargo.toml, which adds the Rust steps and the msrv job. */
export const isRust = (ctx: Pick<SyncContext, "read">): boolean => ctx.read(CARGO_PATH) !== null;

/** The semver job, which Rust repos add before msrv; it runs `repo release api` with cargo-semver-checks installed. */
export const semverJob = (): string =>
  [
    "  semver:",
    `    name: ${SEMVER_JOB}`,
    "    runs-on: ubuntu-latest",
    `    timeout-minutes: ${TEST_TIMEOUT_MINUTES}`,
    "    steps:",
    CHECKOUT_FULL_STEP,
    SETUP_BUN_STEP,
    INSTALL_STEP,
    SEMVER_STEPS,
  ].join("\n");

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
