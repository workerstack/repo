import fs from "node:fs";
import path from "node:path";

import type { Result } from "../result.ts";
import { waitFor, type Runner, type WaitOutcome } from "../scripts/ci-wait.ts";
import { readWorkflow, type WorkflowRead } from "../workflow.ts";
import { stampChangelog } from "./changelog.ts";
import { must, read, type Tools } from "./git.ts";
import { writeVersion } from "./manifest.ts";
import { makePlan, type Plan } from "./plan.ts";
import {
  HOOKS_REFUSED,
  NOT_CHECKOUT,
  PREFIX,
  USAGE,
  ciFailed,
  ciNoResult,
  ciNothing,
  ciSuperseded,
  summary,
} from "./release-messages.constants.ts";
import { releaseByPullRequest } from "./release-pr.ts";
import {
  ARROW,
  CHANGELOG_FILE,
  FLAG_PRE,
  FLAG_STABLE,
  GIT_ADD,
  GIT_COMMIT,
  GIT_HEAD,
  GIT_PUSH,
  GIT_PUSH_TAG,
  GIT_RESET,
  GIT_TAG,
  GIT_TAG_DELETE,
  GIT_TOPLEVEL,
  ISO_DATE_LENGTH,
  PRE_ID,
  RELEASE_SUBJECT,
  SHA_SHOWN,
} from "./release.constants.ts";
import type { Mode } from "./version.ts";

/** Where `repo release` runs and prints, and the git, gh, clock and sleep it works through. */
export type ReleaseIo = {
  cwd: string;
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  git: Runner;
  gh: Runner;
  /** Milliseconds; the clock the wait for CI is measured on, and today's date in the changelog. */
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  /** The workflow the root's repo.config.ts names; `readWorkflow` when omitted. */
  workflow?: (root: string) => WorkflowRead;
};

/** The mode the arguments ask for, or the usage line. */
function parseMode(argv: readonly string[]): Result<Mode, string> {
  const [flag, id, ...rest] = argv;

  if (flag === undefined) return { ok: true, value: { kind: "auto" } };

  if (flag === FLAG_STABLE && id === undefined) return { ok: true, value: { kind: "stable" } };

  if (flag === FLAG_PRE && id !== undefined && PRE_ID.test(id) && rest.length === 0)
    return { ok: true, value: { id, kind: "pre" } };

  return { error: USAGE, ok: false };
}

function refuse(io: ReleaseIo, line: string): number {
  io.stderr(`${PREFIX}${line}\n`);

  return 1;
}

/** Writes the stamped changelog (and the version, for a bump) and commits both; restores the files if git refuses. */
function commitRelease(t: Tools, io: ReleaseIo, plan: Plan): void {
  const file = path.join(t.cwd, CHANGELOG_FILE);
  fs.writeFileSync(
    file,
    stampChangelog(
      fs.readFileSync(file, "utf8"),
      plan.version,
      new Date(io.now()).toISOString().slice(0, ISO_DATE_LENGTH),
    ),
  );

  if (plan.action === "bump") writeVersion(t.cwd, plan.version);

  try {
    must(t, GIT_ADD);
    const got = t.git(GIT_COMMIT(RELEASE_SUBJECT(plan.tag)), t.cwd);

    if (got.code !== 0) {
      io.stderr(`${got.stdout}${got.stderr}`);
      throw new Error(HOOKS_REFUSED);
    }
  } catch (error) {
    must(t, GIT_RESET);
    throw error;
  }
}

/** The refusal line for a CI wait that did not pass. */
export function ciLine(outcome: Exclude<WaitOutcome, { kind: "passed" }>, short: string): string {
  if (outcome.kind === "failed") return ciFailed(short);

  if (outcome.kind === "superseded") return ciSuperseded(short);

  return outcome.kind === "nothing" ? ciNothing(short, outcome.line) : ciNoResult(short, outcome.detail);
}

/** Tags `sha` and pushes the tag; a tag that did not reach origin is deleted again, so a rerun makes it. */
function publishTag(t: Tools, tag: string, sha: string): void {
  must(t, [...GIT_TAG(tag), sha]);

  try {
    must(t, GIT_PUSH_TAG(tag));
  } catch (error) {
    must(t, GIT_TAG_DELETE(tag));
    throw error;
  }
}

/** What the release did before the wait on CI (`steps`), and the release commit it tags once CI passed (`sha`). */
type Done = { plan: Plan; steps: readonly string[]; sha: string };

/** Waits on CI for HEAD and, when it passed, tags the release commit and prints the summary; the exit code. */
async function waitAndTag(t: Tools, io: ReleaseIo, { plan, steps, sha }: Done): Promise<number> {
  const short = read(t, GIT_HEAD).slice(0, SHA_SHOWN);
  const printed: string[] = [];
  const outcome = await waitFor({ ...io, cwd: t.cwd, gh: t.gh, git: t.git, stdout: (text) => printed.push(text) });

  if (outcome.kind !== "passed") {
    io.stdout(printed.join(""));

    return refuse(io, ciLine(outcome, short));
  }

  publishTag(t, plan.tag, sha);
  const move = plan.action === "bump" ? `${plan.from} ${ARROW} ${plan.version}` : plan.version;
  io.stdout(`${summary({ move, name: plan.name, steps, tag: plan.tag })}\n`);

  return 0;
}

/** Commits and pushes what the plan needs, waits on CI for HEAD, and tags it when CI passed. */
function carryOut(t: Tools, io: ReleaseIo, plan: Plan): Promise<number> {
  const steps: string[] = [];

  if (plan.action === "none") {
    steps.push("already committed");
  } else {
    commitRelease(t, io, plan);
    steps.push("committed");
  }

  if (plan.action !== "none" || plan.ahead > 0) {
    must(t, GIT_PUSH(plan.branch));
    steps.push("pushed");
  }

  return waitAndTag(t, io, { plan, sha: read(t, GIT_HEAD), steps });
}

/** The release of the checkout `t` through a pull request, with the steps it shares with `carryOut`. */
function throughPullRequest(t: Tools, io: ReleaseIo, mode: Mode): Promise<number> {
  return releaseByPullRequest(t, {
    commit: (cwd, plan) => commitRelease({ ...t, cwd }, io, plan),
    plan: () => makePlan(t, mode),
    stderr: io.stderr,
    stdout: io.stdout,
    tag: (plan, sha) => waitAndTag(t, io, { plan, sha, steps: ["already committed"] }),
  });
}

/** `repo release [--stable | --pre <id>]`: the whole release of the root package, or the reason it stopped. */
export async function releaseMain(argv: readonly string[], io: ReleaseIo): Promise<number> {
  const mode = parseMode(argv);

  if (!mode.ok) return refuse(io, mode.error);
  const root = io.git([...GIT_TOPLEVEL], io.cwd).stdout.trim();

  if (root === "") return refuse(io, NOT_CHECKOUT);
  const tools: Tools = { cwd: root, gh: io.gh, git: io.git };

  try {
    if ((io.workflow ?? readWorkflow)(root) === "pull-request") return await throughPullRequest(tools, io, mode.value);
    const plan = await makePlan(tools, mode.value);

    return plan.ok ? await carryOut(tools, io, plan.value) : refuse(io, plan.error);
  } catch (error) {
    return refuse(io, (error /* only Errors are thrown here */ as Error).message);
  }
}
