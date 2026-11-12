import { hasOwnedHeader } from "./header.ts";
import type { Generator, SyncContext } from "./outputs.ts";
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

function render(job: Job): string {
  return [
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
}

const JOBS: readonly Job[] = [
  {
    command: "gate",
    env: GATE_ENV,
    id: "gate",
    minutes: GATE_TIMEOUT_MINUTES,
    permissions: GATE_PERMISSIONS,
    steps: [CHECKOUT_TAG_FULL_STEP, ...BUN_STEPS],
  },
  {
    command: "publish",
    env: PUBLISH_ENV,
    id: "publish",
    minutes: PUBLISH_TIMEOUT_MINUTES,
    needs: "gate",
    permissions: PUBLISH_PERMISSIONS,
    steps: [CHECKOUT_TAG_STEP, ...BUN_STEPS, ...NODE_STEPS],
  },
  {
    command: "github",
    env: GATE_ENV,
    id: "github",
    minutes: GITHUB_TIMEOUT_MINUTES,
    needs: "publish",
    permissions: GITHUB_PERMISSIONS,
    steps: [CHECKOUT_TAG_STEP, ...BUN_STEPS],
  },
];

/**
 * Under the release pack with a public root package, the tracked, whole-file `release.yml`; a hand-written one is
 * refused.
 */
export function releaseWorkflow(ctx: SyncContext): ReturnType<Generator> {
  const { name, private: isPrivate } = ctx.workspace.manifest;

  if (!ctx.config.packs.includes("release") || name === undefined || isPrivate !== false)
    return { errors: [], outputs: [] };

  const existing = ctx.read(RELEASE_PATH);

  if (existing !== null && !hasOwnedHeader(existing))
    return { errors: [`${RELEASE_PATH} is hand-written; delete it so repo sync can own it`], outputs: [] };

  const content = `${PREAMBLE.replaceAll("%NAME%", name)}\n${JOBS.map(render).join("\n\n")}\n`;

  return { errors: [], outputs: [{ content, kind: "file", managed: "whole", path: RELEASE_PATH, tracked: true }] };
}
