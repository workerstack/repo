import { MUTATE_RUST_STEPS } from "./ci-rust.constants.ts";
import { isRust } from "./ci-rust.ts";
import { hasOwnedHeader } from "./header.ts";
import type { Generator, SyncContext } from "./outputs.ts";
import {
  FLOORS_STEPS,
  LIVE_SCRIPT,
  MUTATE_RUST_RUN,
  MUTATE_STEPS,
  MUTATE_TIMEOUT_MINUTES,
  NIGHTLY_PATH,
  PREAMBLE,
} from "./nightly.constants.ts";
import { STRYKER_CORE, STRYKER_RUNNER } from "../mutate.constants.ts";
import { hasScript } from "./release.ts";
import {
  CHECKOUT_STEP,
  INSTALL_STEP,
  SETUP_BUN_STEP,
  SLOW_TIMEOUT_MINUTES,
  TEST_TIMEOUT_MINUTES,
} from "./release.constants.ts";

const SETUP = [CHECKOUT_STEP, SETUP_BUN_STEP, INSTALL_STEP];

const shardJob = (id: string, total: number, steps: readonly string[]) =>
  [
    `  ${id}:`,
    `    name: ${id} (` + "${{ matrix.shard }}/" + `${total})`,
    "    runs-on: ubuntu-latest",
    `    timeout-minutes: ${MUTATE_TIMEOUT_MINUTES}`,
    "    strategy:",
    "      fail-fast: false",
    "      matrix:",
    `        shard: [${Array.from({ length: total }, (_, at) => at + 1).join(", ")}]`,
    "    steps:",
    ...SETUP,
    ...steps,
  ].join("\n");

const mutateJob = (total: number) => shardJob("mutate", total, [MUTATE_STEPS.replace("%TOTAL%", String(total))]);

const mutateRustJob = (total: number) =>
  shardJob("mutate-rust", total, [MUTATE_RUST_STEPS, MUTATE_RUST_RUN.replaceAll("%TOTAL%", String(total))]);

const floorsJob = (needs: readonly string[]) =>
  [
    "  mutate-floors:",
    "    name: mutate-floors",
    `    needs: ${needs.length === 1 ? needs[0] : `[${needs.join(", ")}]`}`,
    "    runs-on: ubuntu-latest",
    `    timeout-minutes: ${TEST_TIMEOUT_MINUTES}`,
    "    steps:",
    ...SETUP,
    FLOORS_STEPS,
  ].join("\n");

/** The live job: each secret is mapped by name from the repository's secrets, in `env` and nowhere else. */
const liveJob = (secrets: readonly string[]) =>
  [
    "  live:",
    "    name: live",
    "    runs-on: ubuntu-latest",
    `    timeout-minutes: ${SLOW_TIMEOUT_MINUTES}`,
    ...(secrets.length > 0 ? ["    env:", ...secrets.map((name) => `      ${name}: \${{ secrets.${name} }}`)] : []),
    "    steps:",
    ...SETUP,
    `      - run: bun run ${LIVE_SCRIPT}`,
  ].join("\n");

/** Under the release pack, the tracked, whole-file `.github/workflows/nightly.yml`; a hand-written one is refused. */
export const nightly: Generator = (ctx: SyncContext) => {
  if (!ctx.config.packs.includes("release")) return { outputs: [], errors: [] };
  const existing = ctx.read(NIGHTLY_PATH);
  if (existing !== null && !hasOwnedHeader(existing)) {
    return { outputs: [], errors: [`${NIGHTLY_PATH} is hand-written; delete it so repo sync can own it`] };
  }
  const { shards, secrets } = ctx.config.nightly;
  const live = hasScript(ctx, LIVE_SCRIPT) ? [liveJob(secrets)] : [];
  const { dependencies = {}, devDependencies = {} } = ctx.workspace.manifest;
  const stryker = [STRYKER_CORE, STRYKER_RUNNER].every((name) => name in dependencies || name in devDependencies);
  const rust = isRust(ctx);
  const mutate = [
    ...(stryker || !rust ? [{ id: "mutate", job: mutateJob(shards) }] : []),
    ...(rust ? [{ id: "mutate-rust", job: mutateRustJob(shards) }] : []),
  ];
  const jobs = [...mutate.map(({ job }) => job), floorsJob(mutate.map(({ id }) => id)), ...live];
  const content = `${PREAMBLE}\n${jobs.join("\n\n")}\n`;
  return { outputs: [{ kind: "file", path: NIGHTLY_PATH, content, tracked: true, managed: "whole" }], errors: [] };
};
