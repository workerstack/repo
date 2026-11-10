import { expect, it } from "vitest";
import { ADMIN, CHECKS, GITHUB_ACTIONS_ID, must, served, wantedOf } from "./fixtures/github-wanted.ts";
import { context } from "./fixtures/release-context.ts";
import { MANIFEST } from "./fixtures/github-repo.ts";
import { driftOf, wantedSettings } from "./github.ts";
import { ciJobNames } from "./sync/release.ts";

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
  expect(wantedOf().rulesets[0]).toEqual(MAIN);
});

it("wants the release tags ruleset: only an admin creates, moves or deletes a version tag", () => {
  expect(wantedOf().rulesets[1]).toEqual(TAGS);
});

it("lets admins bypass both rulesets, always", () => {
  expect(wantedOf().rulesets.map((ruleset) => ruleset.bypass_actors)).toEqual([[ADMIN], [ADMIN]]);
});

it("requires exactly the job names the generated ci.yml reports, each from GitHub Actions, without strictness", () => {
  const names = ciJobNames(context(["release"], { name: "pkg", private: false, scripts: { "test:e2e": "vitest" } }));
  const rule = wantedOf(MANIFEST, names).rulesets[0]?.rules.find((r) => r.type === "required_status_checks");
  const checks = names.map((name) => ({ context: name, integration_id: GITHUB_ACTIONS_ID }));
  expect(rule?.parameters?.required_status_checks).toEqual(checks);
  expect(rule?.parameters?.strict_required_status_checks_policy).toBe(false);
});

it("asks for no status check rule when CI runs no job", () => {
  const main = must(wantedOf(MANIFEST, []).rulesets[0]);
  expect(main.rules.map((rule) => rule.type)).toEqual(["deletion", "non_fast_forward", "pull_request"]);
});

it("takes the description and homepage as written, and slugs the keywords into topics", () => {
  const keywords = ["Agents", "My Tool!", "a  b", "x".repeat(60), "-ci-", "agents"];
  const wanted = wantedOf({ ...MANIFEST, keywords });
  expect(wanted.description).toBe(MANIFEST.description);
  expect(wanted.homepage).toBe(MANIFEST.homepage);
  expect(wanted.topics).toEqual(["agents", "my-tool", "a-b", "x".repeat(50), "ci"]);
});

it("refuses a keyword that leaves no topic", () => {
  const refusal = (keyword: string) => `keyword "${keyword}" gives no valid topic: use letters, digits and dashes`;
  expect(wantedSettings({ keywords: ["ok", "!!!", "--"] }, CHECKS)).toEqual({
    ok: false,
    errors: [refusal("!!!"), refusal("--")],
  });
});

it("leaves what package.json does not say alone", () => {
  const wanted = wantedOf({});
  expect([wanted.description, wanted.homepage, wanted.topics]).toEqual([undefined, undefined, undefined]);
  const other = { ...served(wanted), description: "x", homepage: "y", topics: ["z"] };
  expect(driftOf(wanted, other)).toEqual([]);
});
