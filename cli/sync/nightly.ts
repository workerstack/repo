import { lines } from "../scripts/managed-text.ts";
import type { Generator, SyncContext } from "./outputs.ts";
import {
  FLOORS_STEPS,
  LIVE_SCRIPT,
  MUTATE_STEPS,
  MUTATE_TIMEOUT_MINUTES,
  NIGHTLY_HEADER,
  NIGHTLY_PATH,
  PREAMBLE,
} from "./nightly.constants.ts";
import { hasScript } from "./release.ts";
import {
  CHECKOUT_STEP,
  INSTALL_STEP,
  SETUP_BUN_STEP,
  SLOW_TIMEOUT_MINUTES,
  TEST_TIMEOUT_MINUTES,
} from "./release.constants.ts";

const SETUP = [CHECKOUT_STEP, SETUP_BUN_STEP, INSTALL_STEP];

const mutateJob = (total: number) =>
  [
    "  mutate:",
    "    name: mutate (${{ matrix.shard }}/" + `${total})`,
    "    runs-on: ubuntu-latest",
    `    timeout-minutes: ${MUTATE_TIMEOUT_MINUTES}`,
    "    strategy:",
    "      fail-fast: false",
    "      matrix:",
    `        shard: [${Array.from({ length: total }, (_, at) => at + 1).join(", ")}]`,
    "    steps:",
    ...SETUP,
    MUTATE_STEPS.replace("%TOTAL%", String(total)),
  ].join("\n");

const floorsJob = () =>
  [
    "  mutate-floors:",
    "    name: mutate-floors",
    "    needs: mutate",
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
  if (existing !== null && lines(existing)[0] !== NIGHTLY_HEADER) {
    return { outputs: [], errors: [`${NIGHTLY_PATH} is hand-written; delete it so repo sync can own it`] };
  }
  const { shards, secrets } = ctx.config.nightly;
  const live = hasScript(ctx, LIVE_SCRIPT) ? [liveJob(secrets)] : [];
  const jobs = [mutateJob(shards), floorsJob(), ...live];
  const content = `${NIGHTLY_HEADER}\n${PREAMBLE}\n${jobs.join("\n\n")}\n`;
  return { outputs: [{ kind: "file", path: NIGHTLY_PATH, content, tracked: true, managed: "whole" }], errors: [] };
};
