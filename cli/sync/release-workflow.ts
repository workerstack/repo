import { lines } from "../scripts/managed-text.ts";
import type { Generator } from "./outputs.ts";
import {
  BUN_STEPS,
  CHECKOUT_TAG_FULL_STEP,
  CHECKOUT_TAG_STEP,
  GATE_ENV,
  GATE_PERMISSIONS,
  GATE_TIMEOUT_MINUTES,
  GITHUB_PERMISSIONS,
  GITHUB_TIMEOUT_MINUTES,
  NODE_STEPS,
  PREAMBLE,
  PUBLISH_ENV,
  PUBLISH_PERMISSIONS,
  PUBLISH_TIMEOUT_MINUTES,
  RELEASE_HEADER,
  RELEASE_PATH,
} from "./release-workflow.constants.ts";

type Job = {
  id: string;
  needs?: string;
  minutes: number;
  permissions: string;
  env: string;
  steps: readonly string[];
  command: string;
};

const render = (job: Job): string =>
  [
    `  ${job.id}:`,
    `    name: ${job.id}`,
    ...(job.needs === undefined ? [] : [`    needs: ${job.needs}`]),
    "    runs-on: ubuntu-latest",
    `    timeout-minutes: ${job.minutes}`,
    job.permissions,
    job.env,
    "    steps:",
    ...job.steps,
    `      - run: bun repo release ${job.command} "$TAG"`,
  ].join("\n");

const JOBS: readonly Job[] = [
  {
    id: "gate",
    minutes: GATE_TIMEOUT_MINUTES,
    permissions: GATE_PERMISSIONS,
    env: GATE_ENV,
    steps: [CHECKOUT_TAG_FULL_STEP, ...BUN_STEPS],
    command: "gate",
  },
  {
    id: "publish",
    needs: "gate",
    minutes: PUBLISH_TIMEOUT_MINUTES,
    permissions: PUBLISH_PERMISSIONS,
    env: PUBLISH_ENV,
    steps: [CHECKOUT_TAG_STEP, ...BUN_STEPS, ...NODE_STEPS],
    command: "publish",
  },
  {
    id: "github",
    needs: "publish",
    minutes: GITHUB_TIMEOUT_MINUTES,
    permissions: GITHUB_PERMISSIONS,
    env: GATE_ENV,
    steps: [CHECKOUT_TAG_STEP, ...BUN_STEPS],
    command: "github",
  },
];

/** Under the release pack with a public root package, the tracked, whole-file `release.yml`; a hand-written one is refused. */
export const releaseWorkflow: Generator = (ctx) => {
  const { name, private: isPrivate } = ctx.workspace.manifest;
  if (!ctx.config.packs.includes("release") || name === undefined || isPrivate !== false) {
    return { outputs: [], errors: [] };
  }
  const existing = ctx.read(RELEASE_PATH);
  if (existing !== null && lines(existing)[0] !== RELEASE_HEADER) {
    return { outputs: [], errors: [`${RELEASE_PATH} is hand-written; delete it so repo sync can own it`] };
  }
  const content = `${RELEASE_HEADER}\n${PREAMBLE.replaceAll("%NAME%", name)}\n${JOBS.map(render).join("\n\n")}\n`;
  return { outputs: [{ kind: "file", path: RELEASE_PATH, content, tracked: true, managed: "whole" }], errors: [] };
};
