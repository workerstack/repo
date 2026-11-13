import {
  API_STEP,
  CHECKOUT_FULL_STEP,
  CHECKOUT_STEP,
  COMMITS_JOB,
  COMMITS_STEP,
  CONSUMER_JOB,
  CONSUMER_STEP,
  CONSUMER_TIMEOUT_MINUTES,
  INSTALL_STEP,
  SETUP_BUN_STEP,
  SKIPS_JOB,
  SKIPS_STEPS,
  TEST_TIMEOUT_MINUTES,
} from "./release.constants.ts";

/** The ci.yml job of this name. */
export function commitsJob(): string {
  return [
    "  commits:",
    `    name: ${COMMITS_JOB}`,
    "    runs-on: ubuntu-latest",
    `    timeout-minutes: ${TEST_TIMEOUT_MINUTES}`,
    "    steps:",
    CHECKOUT_FULL_STEP,
    SETUP_BUN_STEP,
    INSTALL_STEP,
    COMMITS_STEP,
  ].join("\n");
}

/** The ci.yml job of this name. */
export function skipsJob(): string {
  return [
    "  skips:",
    `    name: ${SKIPS_JOB}`,
    "    needs: test",
    "    runs-on: ubuntu-latest",
    `    timeout-minutes: ${TEST_TIMEOUT_MINUTES}`,
    "    steps:",
    CHECKOUT_STEP,
    SETUP_BUN_STEP,
    INSTALL_STEP,
    SKIPS_STEPS,
  ].join("\n");
}

/** The ci.yml job of this name. */
export function consumerJob({ rust }: { rust: boolean }): string {
  return [
    "  consumer:",
    `    name: ${CONSUMER_JOB}`,
    "    runs-on: ubuntu-latest",
    `    timeout-minutes: ${CONSUMER_TIMEOUT_MINUTES}`,
    "    steps:",
    CHECKOUT_FULL_STEP,
    SETUP_BUN_STEP,
    INSTALL_STEP,
    CONSUMER_STEP,
    ...(rust ? [] : [API_STEP]),
  ].join("\n");
}
