import { expect, it } from "vitest";

import { EMPTY_SETTINGS, fakeGh } from "./__fixtures__/github-store.ts";
import { must, wantedOf } from "./__fixtures__/github-wanted.ts";
import type { Gh, GhFailure } from "./github-gh.ts";
import { readCurrent } from "./github-read.ts";
import { isString, type JsonObject } from "./json.ts";

const BASE = "repos/o/r";
const ALERTS = `${BASE}/vulnerability-alerts`;

const ENABLED = {
  dependabot_security_updates: { status: "enabled" },
  secret_scanning: { status: "enabled" },
  secret_scanning_push_protection: { status: "enabled" },
};

const REPO = {
  default_branch: "main",
  description: null,
  homepage: null,
  private: false,
  security_and_analysis: ENABLED,
  topics: [],
};

const GOOD: JsonObject = {
  [ALERTS]: "",
  [BASE]: REPO,
  [`${BASE}/private-vulnerability-reporting`]: { enabled: true },
  [`${BASE}/rulesets`]: [],
};

function failure(kind: GhFailure["kind"], status?: number): GhFailure {
  return {
    kind,
    message: "x",
    ok: false,
    ...(status === undefined ? {} : { status }),
  };
}

/** A gh that answers each path from `json`, as text or JSON, unless `fails` has a failure for it. */
function canned(json: JsonObject, fails: Record<string, GhFailure> = {}): Gh {
  return ({ path }) => {
    const failed = fails[path];

    if (failed !== undefined) return Promise.resolve(failed);
    const answer = json[path];

    return Promise.resolve({ ok: true, stdout: isString(answer) ? answer : JSON.stringify(answer ?? {}) });
  };
}

it("reads the settings the fake serves, null text as empty, and only the managed rulesets", async () => {
  const [main, tags] = wantedOf().rulesets.map((ruleset, index) => ({ ...ruleset, id: index + 1 }));
  const other = { ...must(main), id: 9, name: "other" };
  const rulesets = [must(main), other, must(tags)];
  const fake = fakeGh({ ...EMPTY_SETTINGS(), reporting: true, rulesets, topics: ["a"] });
  const result = await readCurrent(fake.gh, "o/r", wantedOf());
  expect(result).toMatchObject({
    current: {
      alerts: true,
      description: "",
      homepage: "",
      pushProtection: true,
      reporting: true,
      scanning: true,
      securityUpdates: true,
      topics: ["a"],
    },
    ok: true,
  });
  expect(result.ok && result.current.rulesets.map((ruleset) => ruleset.name)).toStrictEqual(["main", "release tags"]);
  expect(fake.calls.map((call) => call.path)).not.toContain(`${BASE}/rulesets/9`);
});

it("reads Dependabot alerts as off on a 404", async () => {
  const off = await readCurrent(canned(GOOD, { [ALERTS]: failure("http", 404) }), "o/r", wantedOf());
  expect(off).toMatchObject({ current: { alerts: false }, ok: true });
});

it("reads each security status as on only when it says enabled", async () => {
  const off = {
    dependabot_security_updates: { status: "disabled" },
    secret_scanning: { status: "disabled" },
    secret_scanning_push_protection: { status: "disabled" },
  };

  const answer = { ...REPO, security_and_analysis: off };
  const result = await readCurrent(canned({ ...GOOD, [BASE]: answer }), "o/r", wantedOf());
  expect(result).toMatchObject({
    current: { pushProtection: false, scanning: false, securityUpdates: false },
    ok: true,
  });
});

it("fails when the repo answer has no security_and_analysis, never reading it as on", async () => {
  const unexpected = { kind: "other", message: "GitHub answered something unexpected", ok: false };
  const { security_and_analysis: _, ...answer } = REPO;
  expect(await readCurrent(canned({ ...GOOD, [BASE]: answer }), "o/r", wantedOf())).toStrictEqual(unexpected);
});

it("reads an actor with no id as 0", async () => {
  const ruleset = {
    bypass_actors: [{ actor_id: null, actor_type: "OrganizationAdmin", bypass_mode: "always" }],
    conditions: { ref_name: { exclude: [], include: [] } },
    enforcement: "active",
    id: 1,
    name: "main",
    rules: [{ type: "deletion" }],
    target: "branch",
  };

  const json = { ...GOOD, [`${BASE}/rulesets`]: [{ id: 1, name: "main" }], [`${BASE}/rulesets/1`]: ruleset };
  const result = await readCurrent(canned(json), "o/r", wantedOf());
  expect(result.ok && result.current.rulesets[0]?.bypass_actors).toStrictEqual([
    { actor_id: 0, actor_type: "OrganizationAdmin", bypass_mode: "always" },
  ]);
});

const PATHS = [`${BASE}/rulesets`, BASE, `${BASE}/private-vulnerability-reporting`, ALERTS];

it.each(PATHS)("fails with the failure of %s when that call fails", async (path) => {
  const result = await readCurrent(canned(GOOD, { [path]: failure("http", 500) }), "o/r", wantedOf());
  expect(result).toStrictEqual(failure("http", 500));
});

it("fails when a managed ruleset cannot be read by id", async () => {
  const stored = { ...must(wantedOf().rulesets[0]), id: 1 };

  const fake = fakeGh({ ...EMPTY_SETTINGS(), rulesets: [stored] }, (call) =>
    call.path.endsWith("/rulesets/1") ? failure("timeout") : undefined,
  );

  expect(await readCurrent(fake.gh, "o/r", wantedOf())).toStrictEqual(failure("timeout"));
});

it.each(["<html>", { topics: "x" }])("fails on the answer %j, which is not the expected shape", async (answer) => {
  const unexpected = { kind: "other", message: "GitHub answered something unexpected", ok: false };
  expect(await readCurrent(canned({ ...GOOD, [BASE]: answer }), "o/r", wantedOf())).toStrictEqual(unexpected);
});
