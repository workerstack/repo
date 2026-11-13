import { afterEach, expect, it } from "vitest";

import { EVALS_FILES, githubRepo } from "./__fixtures__/github-repo.ts";
import { DENIED, DENIED_LINE, cleanGithubTemps, run, settledSettings } from "./__fixtures__/github-run.ts";
import { SETTLED_ENVIRONMENT, VIEWER_ID, fakeGh } from "./__fixtures__/github-store.ts";
import type { GhFailure } from "./github-gh.ts";

afterEach(cleanGithubTemps);

const ENVIRONMENT = "repos/workerstack/repo/environments/evals";
const POLICIES = `${ENVIRONMENT}/deployment-branch-policies`;

it("creates the evals environment with the admin as reviewer and only the default branch", async () => {
  const cwd = githubRepo({ files: EVALS_FILES });
  const fake = fakeGh(await settledSettings(cwd, { environment: null }));
  fake.calls.length = 0;
  expect(await run(cwd, fake)).toStrictEqual({
    code: 0,
    err: "",
    out: "repo github: workerstack/repo · evals environment created\n",
  });
  expect(fake.writes()).toStrictEqual([
    {
      body: {
        deployment_branch_policy: { custom_branch_policies: true, protected_branches: false },
        prevent_self_review: false,
        reviewers: [{ id: VIEWER_ID, type: "User" }],
        wait_timer: 0,
      },
      method: "PUT",
      path: ENVIRONMENT,
    },
    { body: { name: "main", type: "branch" }, method: "POST", path: POLICIES },
  ]);
  expect(fake.settings.environment).toMatchObject({ ...SETTLED_ENVIRONMENT(), policies: [{ name: "main" }] });
  fake.calls.length = 0;
  const again = await run(cwd, fake);

  expect(again.out).toBe("repo github: workerstack/repo · up to date\n");
  expect(fake.writes()).toStrictEqual([]);
});

it("keeps a Team reviewer and the wait timer, and drops a branch policy that is not the default", async () => {
  const cwd = githubRepo({ files: EVALS_FILES });
  const team = { id: 9, type: "Team" as const };

  const environment = {
    ...SETTLED_ENVIRONMENT(),
    policies: [
      { id: 1, name: "main" },
      { id: 2, name: "dev" },
    ],
  };

  const drifted = { ...environment, preventSelfReview: true, reviewers: [team], waitTimer: 5 };
  const fake = fakeGh(await settledSettings(cwd, { environment: drifted }));
  fake.calls.length = 0;
  const updated = await run(cwd, fake);

  expect(updated.out).toBe("repo github: workerstack/repo · evals environment updated\n");
  expect(fake.writes().map((call) => [call.method, call.path])).toStrictEqual([
    ["PUT", ENVIRONMENT],
    ["DELETE", `${POLICIES}/2`],
  ]);
  expect(fake.settings.environment).toStrictEqual({
    ...environment,
    policies: [{ id: 1, name: "main" }],
    reviewers: [team],
    waitTimer: 5,
  });
});

it("exits 1 when a policy write fails, and a rerun finishes the job", async () => {
  const cwd = githubRepo({ files: EVALS_FILES });
  const settled = await settledSettings(cwd, { environment: null });
  const failed = fakeGh(settled, (call) => (call.method === "POST" && call.path === POLICIES ? DENIED : undefined));
  expect(await run(cwd, failed)).toStrictEqual({ code: 1, err: DENIED_LINE, out: "" });
  const again = await run(cwd, fakeGh(failed.settings));
  expect(again.out).toBe("repo github: workerstack/repo · evals environment updated\n");
  expect(failed.settings.environment?.policies.map((policy) => policy.name)).toStrictEqual(["main"]);
});

const UNPROCESSABLE: GhFailure = { kind: "http", message: "gh: Validation Failed (HTTP 422)", ok: false, status: 422 };

const REFUSALS: [string, boolean, GhFailure, string][] = [
  [
    "names the plan when a private repo's reviewer is refused",
    true,
    UNPROCESSABLE,
    "repo github: workerstack/repo: GitHub refused the evals environment's required reviewer; " +
      "a private repo needs GitHub Enterprise for it, or make the repo public\n",
  ],
  ["gives the admin hint when a private repo's PUT is denied", true, DENIED, DENIED_LINE],
  [
    "gives the plain failure when a public repo's PUT is refused",
    false,
    UNPROCESSABLE,
    "repo github: gh cannot change workerstack/repo's settings (HTTP 422): log in as an admin with `gh auth login`\n",
  ],
  [
    "gives the plain failure when a private repo's PUT times out",
    true,
    { kind: "timeout", message: "gh did not answer within 5s", ok: false },
    "repo github: gh cannot change workerstack/repo's settings (gh did not answer within 5s): try again\n",
  ],
];

it.each(REFUSALS)("%s", async (...[, isPrivate, failure, err]) => {
  const cwd = githubRepo({ files: EVALS_FILES });
  const settled = await settledSettings(cwd, { environment: null, isPrivate });
  const fake = fakeGh(settled, (call) => (call.method === "PUT" && call.path === ENVIRONMENT ? failure : undefined));
  expect(await run(cwd, fake)).toStrictEqual({ code: 1, err, out: "" });
});
