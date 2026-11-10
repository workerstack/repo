import { afterEach, expect, it } from "vitest";
import { DENIED, cleanGithubTemps, run, settledSettings } from "./fixtures/github-run.ts";
import { MANIFEST, githubRepo } from "./fixtures/github-repo.ts";
import { EMPTY_SETTINGS, fakeGh, type Settings } from "./fixtures/github-store.ts";
import { RUN, must } from "./fixtures/github-wanted.ts";
import type { CurrentRuleset, Rule } from "./github.types.ts";

afterEach(cleanGithubTemps);

/** The main ruleset without its `consumer` required check. */
function withoutConsumer(main: CurrentRuleset): CurrentRuleset {
  const rules = main.rules.map((rule): Rule => {
    if (rule.type !== "required_status_checks") return rule;
    const checks = rule.parameters?.required_status_checks?.filter((check) => check.context !== "consumer");
    return { ...rule, parameters: { ...rule.parameters, required_status_checks: checks } };
  });
  return { ...main, rules };
}

it("prints each setting that drifted with how to fix it, and exits 1 without writing", async () => {
  const cwd = githubRepo();
  const settled = await settledSettings(cwd);
  const drifted: Settings = {
    ...settled,
    rulesets: [withoutConsumer(must(settled.rulesets[0]))],
    reporting: false,
    alerts: false,
    description: "x",
    topics: ["lint"],
  };
  const fake = fakeGh(drifted);
  const result = await run(cwd, fake, ["--check"]);
  expect([result.code, result.out]).toEqual([1, ""]);
  expect(result.err.split("\n")).toEqual([
    `repo github: ruleset main is missing the required check "consumer": ${RUN}`,
    `repo github: ruleset release tags is missing: ${RUN}`,
    `repo github: private vulnerability reporting is off: ${RUN}`,
    `repo github: Dependabot alerts are off: ${RUN}`,
    `repo github: description is "x", package.json says "${MANIFEST.description}": ${RUN}`,
    `repo github: topics are [lint], package.json keywords give [agents, ci, lint, monorepo, workerstack]: ${RUN}`,
    "",
  ]);
  expect(fake.writes()).toEqual([]);
});

it("passes a settled repo and says it is up to date", async () => {
  const cwd = githubRepo();
  const fake = fakeGh(await settledSettings(cwd));
  expect(await run(cwd, fake, ["--check"])).toEqual({
    code: 0,
    err: "",
    out: "repo github: workerstack/repo · up to date\n",
  });
});

it("names a denied read as a read", async () => {
  const result = await run(
    githubRepo(),
    fakeGh(EMPTY_SETTINGS(), () => DENIED),
    ["--check"],
  );
  expect(result.err).toBe(
    "repo github: gh cannot read workerstack/repo's settings (HTTP 403): log in as an admin with `gh auth login`\n",
  );
});
