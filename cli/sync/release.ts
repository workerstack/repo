import { lines } from "../scripts/managed-text.ts";
import { isRust, msrvJob } from "./ci-rust.ts";
import { MSRV_JOB, RUST_TOOL_STEPS } from "./ci-rust.constants.ts";
import type { Generator, SyncContext } from "./outputs.ts";
import {
  API_STEP,
  CHECKOUT_FULL_STEP,
  CHECKOUT_STEP,
  CI_HEADER,
  CI_PATH,
  COMMITS_JOB,
  COMMITS_STEP,
  CONSUMER_JOB,
  CONSUMER_STEP,
  CONSUMER_TIMEOUT_MINUTES,
  E2E_JOB,
  E2E_SCRIPT,
  INSTALL_STEP,
  MATRIX,
  MATRIX_OS,
  NON_ROOT_STEP,
  NO_NODE_JOB,
  NO_NODE_STEPS,
  PREAMBLE,
  GATES_STEP,
  SETUP_BUN_STEP,
  SKIPS_JOB,
  SKIPS_STEPS,
  SLOW_TIMEOUT_MINUTES,
  TEST_JOB,
  TEST_OSES,
  TEST_TIMEOUT_MINUTES,
  TURBO_RESTORE_STEP,
  TURBO_SAVE_STEP,
  UPLOAD_STEP,
} from "./release.constants.ts";

const matrix = (minutes: number) =>
  MATRIX.replace("%MINUTES%", String(minutes)).replace("%OSES%", TEST_OSES.join(", "));

/** What the job list reads of a `SyncContext`: the config's packs, the root manifest and the root files. */
export type CiInput = Pick<SyncContext, "config" | "workspace" | "read">;

/** Whether the root manifest's `scripts` has a string `name`. */
export function hasScript(ctx: CiInput, name: string): boolean {
  const scripts: unknown = ctx.workspace.manifest.scripts;
  if (typeof scripts !== "object" || scripts === null) return false;
  return typeof Reflect.get(scripts, name) === "string";
}

/** The test job; under the workspace pack the turbo cache is restored before the gates and saved after them. */
const testJob = (turbo: boolean, rust: string[]) =>
  [
    "  test:",
    `    name: ${TEST_JOB} (${MATRIX_OS})`,
    matrix(TEST_TIMEOUT_MINUTES),
    "    steps:",
    CHECKOUT_STEP,
    SETUP_BUN_STEP,
    NON_ROOT_STEP,
    INSTALL_STEP,
    ...rust,
    ...(turbo ? [TURBO_RESTORE_STEP] : []),
    GATES_STEP,
    ...(turbo ? [TURBO_SAVE_STEP] : []),
    UPLOAD_STEP,
  ].join("\n");

const commitsJob = () =>
  [
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

const skipsJob = () =>
  [
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

const noNodeJob = (e2e: boolean, rust: string[]) =>
  [
    "  no-node:",
    `    name: ${NO_NODE_JOB}`,
    "    runs-on: ubuntu-latest",
    `    timeout-minutes: ${SLOW_TIMEOUT_MINUTES}`,
    "    steps:",
    e2e ? CHECKOUT_FULL_STEP : CHECKOUT_STEP,
    SETUP_BUN_STEP,
    NO_NODE_STEPS,
    INSTALL_STEP,
    ...rust,
    "      - run: bun repo ci",
    ...(e2e ? [`      - run: bun run ${E2E_SCRIPT}`] : []),
  ].join("\n");

const e2eJob = () =>
  [
    "  e2e:",
    `    name: ${E2E_JOB} (${MATRIX_OS})`,
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

const consumerJob = () =>
  [
    "  consumer:",
    `    name: ${CONSUMER_JOB}`,
    "    runs-on: ubuntu-latest",
    `    timeout-minutes: ${CONSUMER_TIMEOUT_MINUTES}`,
    "    steps:",
    CHECKOUT_FULL_STEP,
    SETUP_BUN_STEP,
    INSTALL_STEP,
    CONSUMER_STEP,
    API_STEP,
  ].join("\n");

/** Whether the root is a named, public package, as `releaseWorkflow` decides. */
const isPublic = (ctx: CiInput) =>
  ctx.workspace.manifest.name !== undefined && ctx.workspace.manifest.private === false;

/**
 * The status check names the generated ci.yml reports, one per job and one per OS for the matrix jobs, in the order
 * the file lists them; empty without the release pack, which writes no ci.yml.
 */
export function ciJobNames(ctx: CiInput): string[] {
  if (!ctx.config.packs.includes("release")) return [];
  const matrixed = (job: string) => TEST_OSES.map((os) => `${job} (${os})`);
  const e2e = hasScript(ctx, E2E_SCRIPT);
  return [
    ...matrixed(TEST_JOB),
    COMMITS_JOB,
    SKIPS_JOB,
    NO_NODE_JOB,
    ...(e2e ? matrixed(E2E_JOB) : []),
    ...(isPublic(ctx) ? [CONSUMER_JOB] : []),
    ...(isRust(ctx) ? [MSRV_JOB] : []),
  ];
}

/** Under the release pack, the tracked, whole-file `.github/workflows/ci.yml`; a hand-written one is refused. */
export const release: Generator = (ctx) => {
  if (!ctx.config.packs.includes("release")) return { outputs: [], errors: [] };
  const existing = ctx.read(CI_PATH);
  if (existing !== null && lines(existing)[0] !== CI_HEADER) {
    return { outputs: [], errors: [`${CI_PATH} is hand-written; delete it so repo sync can own it`] };
  }
  const e2e = hasScript(ctx, E2E_SCRIPT);
  const rust = isRust(ctx);
  const tools = rust ? [RUST_TOOL_STEPS] : [];
  const jobs = [
    testJob(ctx.config.packs.includes("workspace"), tools),
    commitsJob(),
    skipsJob(),
    noNodeJob(e2e, tools),
    ...(e2e ? [e2eJob()] : []),
    ...(isPublic(ctx) ? [consumerJob()] : []),
    ...(rust ? [msrvJob()] : []),
  ];
  const content = `${CI_HEADER}\n${PREAMBLE}\n${jobs.join("\n\n")}\n`;
  return { outputs: [{ kind: "file", path: CI_PATH, content, tracked: true, managed: "whole" }], errors: [] };
};
