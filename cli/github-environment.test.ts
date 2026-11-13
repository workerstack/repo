import { afterEach, expect, it } from "vitest";

import { EVALS_FILES, githubRepo } from "./__fixtures__/github-repo.ts";
import { cleanGithubTemps, run, settledSettings } from "./__fixtures__/github-run.ts";
import { SETTLED_ENVIRONMENT, fakeGh, type FakeGh } from "./__fixtures__/github-store.ts";
import { RUN } from "./__fixtures__/github-wanted.ts";
import type { GhCall, GhFailure, GhResult } from "./github-gh.ts";
import type { Environment } from "./github.types.ts";

afterEach(cleanGithubTemps);

const ENVIRONMENT = "repos/workerstack/repo/environments/evals";
const POLICIES = `${ENVIRONMENT}/deployment-branch-policies`;
const SERVER_ERROR: GhFailure = { kind: "http", message: "gh: Server Error (HTTP 500)", ok: false, status: 500 };

/** `repo github --check` on an evals checkout whose environment is `environment`, or none. */
async function checkWith(environment: Environment | null) {
  const cwd = githubRepo({ files: EVALS_FILES });

  return await run(cwd, fakeGh(await settledSettings(cwd, { environment })), ["--check"]);
}

function touchesEnvironment(fake: FakeGh) {
  return fake.calls.some((call) => call.path.includes("environments") || call.path === "user");
}

it("reads and writes no environment without the evals pack", async () => {
  const cwd = githubRepo();
  const fake = fakeGh();
  await run(cwd, fake);
  await run(cwd, fake, ["--check"]);
  expect(touchesEnvironment(fake)).toBe(false);
  expect(fake.settings.environment).toBeNull();
});

const settled = SETTLED_ENVIRONMENT();
const release = { id: 2, name: "release" };

const DRIFTS: [string, Environment | null, string[]][] = [
  ["no environment", null, ["evals environment is missing"]],
  ["no reviewer", { ...settled, reviewers: [] }, ["evals environment has no required reviewer"]],
  [
    "self-review blocked",
    { ...settled, preventSelfReview: true },
    ["evals environment blocks self-review, so the one reviewer cannot approve a run"],
  ],
  [
    "protected branches",
    { ...settled, branches: "protected", policies: [] },
    ["evals environment deploys from any protected branch, not only main"],
  ],
  ["any branch", { ...settled, branches: "any", policies: [] }, ["evals environment deploys from more than main"]],
  [
    "no main policy",
    { ...settled, policies: [release] },
    ["evals environment does not deploy from main", "evals environment deploys from more than main"],
  ],
  [
    "an extra policy",
    { ...settled, policies: [...settled.policies, release] },
    ["evals environment deploys from more than main"],
  ],
];

it.each(DRIFTS)("reports %s as drift", async (_, environment, lines) => {
  const err = lines.map((line) => `repo github: ${line}: ${RUN}\n`).join("");
  expect(await checkWith(environment)).toStrictEqual({ code: 1, err, out: "" });
});

it("passes a settled environment, a Team reviewer and a wait timer included", async () => {
  const environment: Environment = { ...settled, reviewers: [{ id: 9, type: "Team" }], waitTimer: 5 };
  const up = { code: 0, err: "", out: "repo github: workerstack/repo · up to date\n" };
  expect(await checkWith(environment)).toStrictEqual(up);
});

/** A fake whose answer to `path` is `answer`, over a settled evals checkout. */
async function answering(path: string, answer: GhResult) {
  const cwd = githubRepo({ files: EVALS_FILES });
  const fake = fakeGh(await settledSettings(cwd));

  async function gh(call: GhCall): Promise<GhResult> {
    return call.path === path ? answer : await fake.gh(call);
  }

  return await run(cwd, { ...fake, gh }, ["--check"]);
}

const WEIRD: [string, string][] = [
  ["environment", ENVIRONMENT],
  ["branch policy list", POLICIES],
  ["user", "user"],
];

it.each(WEIRD)("fails on a %s answer of another shape", async (_, path) => {
  const { code, err } = await answering(path, { ok: true, stdout: '{"protection_rules":3}' });
  expect([code, err]).toStrictEqual([
    1,
    "repo github: gh cannot read workerstack/repo's settings (GitHub answered something unexpected): try again\n",
  ]);
});

it.each(WEIRD)("fails when the %s read fails", async (_, path) => {
  const { code, err } = await answering(path, SERVER_ERROR);
  expect([code, err]).toStrictEqual([
    1,
    "repo github: gh cannot read workerstack/repo's settings (HTTP 500): log in as an admin with `gh auth login`\n",
  ]);
});

it("fails on a reviewer of a kind it does not know", async () => {
  const reviewers = [{ reviewer: { id: 1 }, type: "Bot" }];
  const body = { deployment_branch_policy: null, protection_rules: [{ reviewers, type: "required_reviewers" }] };
  const { err } = await answering(ENVIRONMENT, { ok: true, stdout: JSON.stringify(body) });

  expect(err).toContain("GitHub answered something unexpected");
});
