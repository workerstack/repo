import { lines } from "../scripts/managed-text.ts";
import type { Generator, SyncContext } from "./outputs.ts";
import {
  CHECKOUT_FULL_STEP,
  CHECKOUT_STEP,
  CI_HEADER,
  CI_PATH,
  COMMITS_STEP,
  E2E_SCRIPT,
  INSTALL_STEP,
  MATRIX,
  NON_ROOT_STEP,
  NO_NODE_STEPS,
  PREAMBLE,
  REPORT_STEPS,
  SETUP_BUN_STEP,
  SKIPS_STEPS,
  SLOW_TIMEOUT_MINUTES,
  TEST_TIMEOUT_MINUTES,
} from "./release.constants.ts";

const matrix = (minutes: number) => MATRIX.replace("%MINUTES%", String(minutes));

/** Whether the root manifest's `scripts` has a string `name`. */
export function hasScript(ctx: SyncContext, name: string): boolean {
  const scripts: unknown = ctx.workspace.manifest.scripts;
  if (typeof scripts !== "object" || scripts === null) return false;
  return typeof Reflect.get(scripts, name) === "string";
}

const testJob = () =>
  [
    "  test:",
    "    name: test (${{ matrix.os }})",
    matrix(TEST_TIMEOUT_MINUTES),
    "    steps:",
    CHECKOUT_STEP,
    SETUP_BUN_STEP,
    NON_ROOT_STEP,
    INSTALL_STEP,
    REPORT_STEPS,
  ].join("\n");

const commitsJob = () =>
  [
    "  commits:",
    "    name: commits",
    "    runs-on: ubuntu-latest",
    `    timeout-minutes: ${TEST_TIMEOUT_MINUTES}`,
    "    steps:",
    CHECKOUT_FULL_STEP,
    SETUP_BUN_STEP,
    INSTALL_STEP,
    COMMITS_STEP,
  ].join("\n");

const skipsJob = () =>
  [
    "  skips:",
    "    name: skips",
    "    needs: test",
    "    runs-on: ubuntu-latest",
    `    timeout-minutes: ${TEST_TIMEOUT_MINUTES}`,
    "    steps:",
    CHECKOUT_STEP,
    SETUP_BUN_STEP,
    INSTALL_STEP,
    SKIPS_STEPS,
  ].join("\n");

const noNodeJob = (e2e: boolean) =>
  [
    "  no-node:",
    "    name: no-node",
    "    runs-on: ubuntu-latest",
    `    timeout-minutes: ${SLOW_TIMEOUT_MINUTES}`,
    "    steps:",
    e2e ? CHECKOUT_FULL_STEP : CHECKOUT_STEP,
    SETUP_BUN_STEP,
    NO_NODE_STEPS,
    INSTALL_STEP,
    "      - run: bun repo ci",
    ...(e2e ? [`      - run: bun run ${E2E_SCRIPT}`] : []),
  ].join("\n");

const e2eJob = () =>
  [
    "  e2e:",
    "    name: e2e (${{ matrix.os }})",
    matrix(SLOW_TIMEOUT_MINUTES),
    "    defaults:",
    "      run:",
    "        shell: bash",
    "    steps:",
    CHECKOUT_FULL_STEP,
    SETUP_BUN_STEP,
    INSTALL_STEP,
    `      - run: bun run ${E2E_SCRIPT}`,
  ].join("\n");

/** Under the release pack, the tracked, whole-file `.github/workflows/ci.yml`; a hand-written one is refused. */
export const release: Generator = (ctx) => {
  if (!ctx.config.packs.includes("release")) return { outputs: [], errors: [] };
  const existing = ctx.read(CI_PATH);
  if (existing !== null && lines(existing)[0] !== CI_HEADER) {
    return { outputs: [], errors: [`${CI_PATH} is hand-written; delete it so repo sync can own it`] };
  }
  const e2e = hasScript(ctx, E2E_SCRIPT);
  const jobs = [testJob(), commitsJob(), skipsJob(), noNodeJob(e2e), ...(e2e ? [e2eJob()] : [])];
  const content = `${CI_HEADER}\n${PREAMBLE}\n${jobs.join("\n\n")}\n`;
  return { outputs: [{ kind: "file", path: CI_PATH, content, tracked: true, managed: "whole" }], errors: [] };
};
