import { expect, it } from "vitest";
import { GITHUB_ACTIONS_ID, RUN, changed, messages, must, served, wantedOf } from "./fixtures/github-wanted.ts";
import { MANIFEST } from "./fixtures/github-repo.ts";
import { driftOf } from "./github.ts";
import type { CurrentRuleset, Rule, RuleParameters } from "./github.types.ts";

/** `rules` with the parameters of the rule of `type` replaced by `change` of them. */
function withParameters(rules: Rule[], type: string, change: (p: RuleParameters) => RuleParameters): Rule[] {
  return rules.map((rule) => (rule.type === type ? { ...rule, parameters: change(rule.parameters ?? {}) } : rule));
}

it("finds no drift in what GitHub serves back for the wanted state, server-filled fields and all", () => {
  expect(driftOf(wantedOf(), served())).toEqual([]);
});

it("ignores the order of rules, checks and topics and parameters it does not manage", () => {
  const reordered = changed("main", (ruleset) => {
    const swapped = withParameters(ruleset.rules, "required_status_checks", (p) => ({
      ...p,
      required_status_checks: (p.required_status_checks ?? []).toReversed(),
    }));
    const merged = withParameters(swapped, "pull_request", (p) => ({ ...p, allowed_merge_methods: ["squash"] }));
    return { ...ruleset, rules: merged.toReversed() };
  });
  expect(driftOf(wantedOf(), { ...reordered, topics: reordered.topics.toReversed() })).toEqual([]);
});

it("names a missing ruleset, by area and name", () => {
  const current = served();
  expect(messages({ ...current, rulesets: [must(current.rulesets[0])] })).toEqual([
    `ruleset release tags is missing: ${RUN}`,
  ]);
  expect(driftOf(wantedOf(), { ...current, rulesets: [] }).map((d) => [d.area, d.name])).toEqual([
    ["ruleset", "main"],
    ["ruleset", "release tags"],
  ]);
});

it("names a required check the ruleset lacks, one from another app, and one CI no longer runs", () => {
  const current = changed("main", (ruleset) => ({
    ...ruleset,
    rules: withParameters(ruleset.rules, "required_status_checks", (p) => ({
      ...p,
      required_status_checks: [
        { context: "commits", integration_id: GITHUB_ACTIONS_ID },
        { context: "old", integration_id: GITHUB_ACTIONS_ID },
        { context: "test (ubuntu-latest)", integration_id: 99 },
      ],
    })),
  }));
  expect(messages(current)).toEqual([
    `ruleset main is missing the required check "test (ubuntu-latest)": ${RUN}`,
    `ruleset main is missing the required check "consumer": ${RUN}`,
    `ruleset main requires "old", which CI does not report: ${RUN}`,
  ]);
});

it("names a missing and an unwanted rule", () => {
  const current = changed("release tags", (ruleset) => ({
    ...ruleset,
    rules: [{ type: "creation" }, { type: "update" }, { type: "required_linear_history" }],
  }));
  expect(messages(current)).toEqual([
    `ruleset release tags is missing the rule "deletion": ${RUN}`,
    `ruleset release tags has the unwanted rule "required_linear_history": ${RUN}`,
  ]);
});

/** The main ruleset changed in every way but its rules' own settings. */
const moved = (ruleset: CurrentRuleset) => ({
  ...ruleset,
  target: "tag",
  enforcement: "disabled",
  conditions: { ref_name: { include: ["refs/heads/dev"], exclude: ["refs/heads/main"] } },
  bypass_actors: [],
});

it("names a changed target, enforcement, refs, approval count, strictness and bypass list", () => {
  const current = changed("main", (ruleset) => {
    const approvals = withParameters(ruleset.rules, "pull_request", () => ({ required_approving_review_count: 1 }));
    const strict = withParameters(approvals, "required_status_checks", (p) => ({
      ...p,
      strict_required_status_checks_policy: true,
    }));
    return { ...moved(ruleset), rules: strict };
  });
  expect(messages(current)).toEqual([
    `ruleset main targets "tag", wanted "branch": ${RUN}`,
    `ruleset main is "disabled", wanted "active": ${RUN}`,
    `ruleset main applies to [refs/heads/dev], wanted [~DEFAULT_BRANCH]: ${RUN}`,
    `ruleset main excludes [refs/heads/main], wanted []: ${RUN}`,
    `ruleset main requires 1 approvals, wanted 0: ${RUN}`,
    `ruleset main has strict status checks true, wanted false: ${RUN}`,
    `ruleset main lets [] bypass, wanted [RepositoryRole 5 always]: ${RUN}`,
  ]);
});

it("names the settings of rules that carry no parameters as unset", () => {
  const current = changed("main", (ruleset) => ({ ...ruleset, rules: ruleset.rules.map((r) => ({ type: r.type })) }));
  expect(messages(current)).toEqual([
    `ruleset main requires unset approvals, wanted 0: ${RUN}`,
    `ruleset main has strict status checks unset, wanted false: ${RUN}`,
    `ruleset main is missing the required check "test (ubuntu-latest)": ${RUN}`,
    `ruleset main is missing the required check "commits": ${RUN}`,
    `ruleset main is missing the required check "consumer": ${RUN}`,
  ]);
});

it("names reporting and alerts that are off", () => {
  expect(driftOf(wantedOf(), { ...served(), reporting: false, alerts: false })).toEqual([
    { area: "reporting", message: `private vulnerability reporting is off: ${RUN}` },
    { area: "alerts", message: `Dependabot alerts are off: ${RUN}` },
  ]);
});

it("names a description, homepage and topics that differ from package.json", () => {
  const current = { ...served(), description: "x", homepage: "", topics: ["lint"] };
  const { description, homepage, keywords } = MANIFEST;
  expect(driftOf(wantedOf(), current)).toEqual([
    {
      area: "description",
      message: `description is "x", package.json says "${description}": ${RUN}`,
      value: description,
    },
    { area: "homepage", message: `homepage is "", package.json says "${homepage}": ${RUN}`, value: homepage },
    {
      area: "topics",
      message: `topics are [lint], package.json keywords give [agents, ci, lint, monorepo, workerstack]: ${RUN}`,
      value: keywords,
    },
  ]);
});
