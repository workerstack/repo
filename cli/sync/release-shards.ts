import { isRust } from "./ci-rust.ts";
import type { SyncContext } from "./outputs.ts";
import {
  CHECKOUT_STEP,
  COVERAGE_JOB,
  COVERAGE_STEPS,
  INSTALL_STEP,
  SETUP_BUN_STEP,
  TEST_SHARDS,
  TEST_TIMEOUT_MINUTES,
  UBUNTU,
  UBUNTU_COVERAGE_SHARDS,
} from "./release.constants.ts";

/** Each OS of a matrix and its shard count. */
export type Shards = readonly (readonly [string, number])[];

/** What the shard decision reads of a `SyncContext`: the config's packs, the root manifest and the root files. */
type ShardInput = Pick<SyncContext, "config" | "workspace" | "read">;

/** Whether the root manifest lists `vitest` among its dependencies or devDependencies. */
function hasVitest(ctx: ShardInput): boolean {
  const { dependencies, devDependencies } = ctx.workspace.manifest;

  return [dependencies, devDependencies].some((deps) => deps !== undefined && Object.hasOwn(deps, "vitest"));
}

/**
 * Whether Ubuntu's tests run in shards whose blobs the coverage job merges: a root vitest run, so neither the workspace
 * pack (a vitest per package) nor Rust (floors once, cargo per shard).
 */
export function shardsCoverage(ctx: ShardInput): boolean {
  return !ctx.config.packs.includes("workspace") && !isRust(ctx) && hasVitest(ctx);
}

/** The test job's OSes and shard counts: Ubuntu is split only when it shards coverage. */
export function testShards({ sharded }: { sharded: boolean }): Shards {
  return TEST_SHARDS.map(([os, total]) => (sharded && os === UBUNTU ? [os, UBUNTU_COVERAGE_SHARDS] : [os, total]));
}

/** The job that merges the Ubuntu shards' blobs and checks every floor. */
export function coverageJob(): string {
  return [
    `  ${COVERAGE_JOB}:`,
    `    name: ${COVERAGE_JOB}`,
    "    needs: test",
    "    runs-on: ubuntu-latest",
    `    timeout-minutes: ${TEST_TIMEOUT_MINUTES}`,
    "    steps:",
    CHECKOUT_STEP,
    SETUP_BUN_STEP,
    INSTALL_STEP,
    COVERAGE_STEPS,
  ].join("\n");
}
