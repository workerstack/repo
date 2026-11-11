import { afterEach, expect, it } from "vitest";
import { cleanGithubTemps } from "./fixtures/github-run.ts";
import { ADMIN, CHECKS, GITHUB_ACTIONS_ID, must, served, wantedOf } from "./fixtures/github-wanted.ts";
import { context } from "./fixtures/release-context.ts";
import { MANIFEST, githubRepo } from "./fixtures/github-repo.ts";
import { driftOf, wantedSettings } from "./github.ts";
import { wantedAt } from "./github-wanted-at.ts";
import { ciJobNames } from "./sync/release.ts";

afterEach(cleanGithubTemps);

const MAIN = {
  name: "main",
  target: "branch",
  enforcement: "active",
  conditions: { ref_name: { include: ["~DEFAULT_BRANCH"], exclude: [] } },
  rules: [
    { type: "deletion" },
    { type: "non_fast_forward" },
    {
      type: "pull_request",
      parameters: {
        required_approving_review_count: 0,
        dismiss_stale_reviews_on_push: false,
        require_code_owner_review: false,
        require_last_push_approval: false,
        required_review_thread_resolution: false,
      },
    },
    {
      type: "required_status_checks",
      parameters: {
        strict_required_status_checks_policy: false,
        required_status_checks: CHECKS.map((name) => ({ context: name, integration_id: GITHUB_ACTIONS_ID })),
      },
    },
  ],
  bypass_actors: [ADMIN],
};

const TAGS = {
  name: "release tags",
  target: "tag",
  enforcement: "active",
  conditions: { ref_name: { include: ["refs/tags/v*", "refs/tags/*@*"], exclude: [] } },
  rules: [{ type: "creation" }, { type: "update" }, { type: "deletion" }],
  bypass_actors: [ADMIN],
};

it("wants the main ruleset: no deletion, no force pushes, a pull request, and every CI check from GitHub Actions", () => {
  expect(wantedOf().rulesets[0]).toStrictEqual(MAIN);
});

it("wants the release tags ruleset: only an admin creates, moves or deletes a version tag", () => {
  expect(wantedOf().rulesets[1]).toStrictEqual(TAGS);
});

it("lets admins bypass both rulesets, always", () => {
  expect(wantedOf().rulesets.map((ruleset) => ruleset.bypass_actors)).toStrictEqual([[ADMIN], [ADMIN]]);
});

it("requires exactly the job names the generated ci.yml reports, each from GitHub Actions, without strictness", () => {
  const names = ciJobNames(context(["release"], { name: "pkg", private: false, scripts: { "test:e2e": "vitest" } }));
  const rule = wantedOf(MANIFEST, names).rulesets[0]?.rules.find((r) => r.type === "required_status_checks");
  const checks = names.map((name) => ({ context: name, integration_id: GITHUB_ACTIONS_ID }));
  expect(rule?.parameters?.required_status_checks).toStrictEqual(checks);
  expect(rule?.parameters?.strict_required_status_checks_policy).toBe(false);
});

it("asks for no status check rule when CI runs no job", () => {
  const main = must(wantedOf(MANIFEST, []).rulesets[0]);
  expect(main.rules.map((rule) => rule.type)).toStrictEqual(["deletion", "non_fast_forward", "pull_request"]);
});

it("takes the description and homepage as written, and the keywords as topics in written order", () => {
  const wanted = wantedOf({ ...MANIFEST, keywords: ["agents", "ci"] });
  expect(wanted.description).toBe(MANIFEST.description);
  expect(wanted.homepage).toBe(MANIFEST.homepage);
  expect(wanted.topics).toStrictEqual(["agents", "ci"]);
});

it.each([
  [["lint", "agents"], ['package.json: "keywords" are not sorted; write ["agents","lint"]']],
  [["agents", 7], ["package.json: keyword 2 is 7, not a string; write it as a GitHub topic"]],
  ["x", ['package.json: "keywords" is "x"; list 1 to 20 GitHub topics']],
  [["My Tool!"], [expect.stringContaining('package.json: keyword "My Tool!" is not a GitHub topic')]],
])("refuses keywords %j with the keyword lines and applies nothing", (keywords, errors) => {
  expect(wantedSettings({ keywords }, CHECKS)).toStrictEqual({ ok: false, errors });
});

it("leaves what package.json does not say alone", () => {
  const wanted = wantedOf({});
  expect([wanted.description, wanted.homepage, wanted.topics]).toStrictEqual([undefined, undefined, undefined]);
  const other = { ...served(wanted), description: "x", homepage: "y", topics: ["z"] };
  expect(driftOf(wanted, other)).toStrictEqual([]);
});

it("wantedAt reads the checkout's Cargo.toml: a Rust repo requires the msrv check, one without does not", async () => {
  const checks = async (files: Record<string, string>) => {
    const wanted = await wantedAt(githubRepo({ files }));
    const rule = wanted.ok
      ? wanted.wanted.rulesets[0]?.rules.find((r) => r.type === "required_status_checks")
      : undefined;
    return rule?.parameters?.required_status_checks?.map((check) => check.context) ?? [];
  };
  expect(await checks({ "Cargo.toml": "[package]\n" })).toContain("msrv");
  expect(await checks({})).not.toContain("msrv");
});
