import { MSRV_JOB, RUST_TOOL_STEPS, SEMVER_JOB } from "./ci-rust.constants.ts";
import { isRust, msrvJob, semverJob } from "./ci-rust.ts";
import { hasOwnedHeader } from "./header.ts";
import type { Generator, SyncContext } from "./outputs.ts";
import {
  API_STEP,
  BUN_CACHE_STEPS,
  CHECKOUT_FULL_STEP,
  CHECKOUT_STEP,
  CI_PATH,
  COMMITS_JOB,
  COMMITS_STEP,
  CONSUMER_JOB,
  CONSUMER_STEP,
  CONSUMER_TIMEOUT_MINUTES,
  E2E_JOB,
  E2E_SCRIPT,
  E2E_PLAYWRIGHT,
  E2E_PLAYWRIGHT_SHARD_STEP,
  E2E_SHARDABLE,
  E2E_SHARD_STEP,
  E2E_SHARDS,
  INSTALL_STEP,
  MATRIX,
  MATRIX_LABEL,
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
  TEST_SHARDS,
  TEST_TIMEOUT_MINUTES,
  TSBUILDINFO_RESTORE_STEP,
  TSBUILDINFO_SAVE_STEP,
  TURBO_RESTORE_STEP,
  TURBO_SAVE_STEP,
  UPLOAD_STEP,
} from "./release.constants.ts";

type Shards = readonly (readonly [string, number])[];

/** Each matrix row as `[os, shard, label]`: an OS of one shard runs whole, with an empty shard and the bare OS. */
const rows = (shards: Shards) =>
  shards.flatMap(([os, total]) =>
    total === 1
      ? [[os, "", os]]
      : Array.from({ length: total }, (_, at) => [os, `${at + 1}/${total}`, `${os} ${at + 1}/${total}`]),
  );

const matrix = (minutes: number, shards: Shards) =>
  [
    MATRIX.replace("%MINUTES%", String(minutes)),
    ...rows(shards).map(
      ([os, shard, label]) => `          - { os: ${os}, shard: ${shard === "" ? '""' : shard}, label: ${label} }`,
    ),
  ].join("\n");

/** What the job list reads of a `SyncContext`: the config's packs, the root manifest and the root files. */
export type CiInput = Pick<SyncContext, "config" | "workspace" | "read">;

/** The root manifest's `scripts` entry `name` when it is a string. */
const scriptOf = (ctx: CiInput, name: string) => {
  const scripts: unknown = ctx.workspace.manifest.scripts;
  const script: unknown = typeof scripts === "object" && scripts !== null ? Reflect.get(scripts, name) : undefined;
  return typeof script === "string" ? script : undefined;
};

/** Whether the root manifest's `scripts` has a string `name`. */
export function hasScript(ctx: CiInput, name: string): boolean {
  return scriptOf(ctx, name) !== undefined;
}

/** Whether a `test:e2e` script runs a command that takes `--shard=i/n`, so Windows can split it. */
const shardable = (script: string) => E2E_SHARDABLE.test(script.trim());

/** A shardable script's run: its runner's no-tests flag lets a shard handed no test file pass. */
const shardStep = (script: string) => (E2E_PLAYWRIGHT.test(script.trim()) ? E2E_PLAYWRIGHT_SHARD_STEP : E2E_SHARD_STEP);

/** The e2e matrix: Windows split under a shardable script, else every OS whole. */
const e2eMatrix = (script: string): Shards => (shardable(script) ? E2E_SHARDS : E2E_SHARDS.map(([os]) => [os, 1]));

/**
 * The test job, one row per shard; the tsbuildinfo, and under the workspace pack the turbo cache, are restored before
 * the gates and saved after them.
 */
const testJob = (turbo: boolean, rust: string[]) =>
  [
    "  test:",
    `    name: ${TEST_JOB} (${MATRIX_LABEL})`,
    matrix(TEST_TIMEOUT_MINUTES, TEST_SHARDS),
    "    steps:",
    CHECKOUT_STEP,
    SETUP_BUN_STEP,
    NON_ROOT_STEP,
    BUN_CACHE_STEPS,
    INSTALL_STEP,
    ...rust,
    ...(turbo ? [TURBO_RESTORE_STEP] : []),
    TSBUILDINFO_RESTORE_STEP,
    GATES_STEP,
    ...(turbo ? [TURBO_SAVE_STEP] : []),
    TSBUILDINFO_SAVE_STEP,
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

const e2eJob = (script: string) =>
  [
    "  e2e:",
    `    name: ${E2E_JOB} (${MATRIX_LABEL})`,
    matrix(SLOW_TIMEOUT_MINUTES, e2eMatrix(script)),
    "    defaults:",
    "      run:",
    "        shell: bash",
    "    steps:",
    CHECKOUT_FULL_STEP,
    SETUP_BUN_STEP,
    BUN_CACHE_STEPS,
    INSTALL_STEP,
    shardable(script) ? shardStep(script) : `      - run: bun run ${E2E_SCRIPT}`,
  ].join("\n");

const consumerJob = (rust: boolean) =>
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
    ...(rust ? [] : [API_STEP]),
  ].join("\n");

/** Whether the root is a named, public package, as `releaseWorkflow` decides. */
const isPublic = (ctx: CiInput) =>
  ctx.workspace.manifest.name !== undefined && ctx.workspace.manifest.private === false;

/**
 * The status check names the generated ci.yml reports, one per job and one per matrix row, in the order
 * the file lists them; empty without the release pack, which writes no ci.yml.
 */
export function ciJobNames(ctx: CiInput): string[] {
  if (!ctx.config.packs.includes("release")) return [];
  const matrixed = (job: string, shards: Shards) => rows(shards).map(([, , label]) => `${job} (${label})`);
  const e2e = scriptOf(ctx, E2E_SCRIPT);
  return [
    ...matrixed(TEST_JOB, TEST_SHARDS),
    COMMITS_JOB,
    SKIPS_JOB,
    NO_NODE_JOB,
    ...(e2e === undefined ? [] : matrixed(E2E_JOB, e2eMatrix(e2e))),
    ...(isPublic(ctx) ? [CONSUMER_JOB] : []),
    ...(isRust(ctx) ? [SEMVER_JOB, MSRV_JOB] : []),
  ];
}

/** Under the release pack, the tracked, whole-file `.github/workflows/ci.yml`; a hand-written one is refused. */
export const release: Generator = (ctx) => {
  if (!ctx.config.packs.includes("release")) return { errors: [], outputs: [] };
  const existing = ctx.read(CI_PATH);
  if (existing !== null && !hasOwnedHeader(existing))
    return { errors: [`${CI_PATH} is hand-written; delete it so repo sync can own it`], outputs: [] };

  const e2e = scriptOf(ctx, E2E_SCRIPT);
  const rust = isRust(ctx);
  const tools = rust ? [RUST_TOOL_STEPS] : [];
  const jobs = [
    testJob(ctx.config.packs.includes("workspace"), tools),
    commitsJob(),
    skipsJob(),
    noNodeJob(e2e !== undefined, tools),
    ...(e2e === undefined ? [] : [e2eJob(e2e)]),
    ...(isPublic(ctx) ? [consumerJob(rust)] : []),
    ...(rust ? [semverJob(), msrvJob()] : []),
  ];
  const content = `${PREAMBLE}\n${jobs.join("\n\n")}\n`;
  return { errors: [], outputs: [{ content, kind: "file", managed: "whole", path: CI_PATH, tracked: true }] };
};
