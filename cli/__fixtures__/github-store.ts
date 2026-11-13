import type { Gh, GhCall, GhFailure, GhResult } from "../github-gh.ts";
import type { Environment, Ruleset } from "../github.types.ts";

/** What the fake GitHub holds; `repo github` reads and writes it through the same paths the API has. */
export type Settings = {
  rulesets: (Ruleset & { id: number })[];
  reporting: boolean;
  alerts: boolean;
  scanning: boolean;
  pushProtection: boolean;
  securityUpdates: boolean;
  description: string | null;
  homepage: string | null;
  topics: string[];
  isPrivate: boolean;
  /** The `evals` environment, or null when the repo has none. */
  environment: Environment | null;
};

/** The id GET `user` answers: the admin who runs `repo github`. */
export const VIEWER_ID = 4242;
export const DEFAULT_BRANCH = "main";

/** An `evals` environment `repo github` is happy with: the viewer reviews, and only the default branch deploys. */
export const SETTLED_ENVIRONMENT = (): Environment => ({
  branches: "custom",
  policies: [{ id: 1, name: DEFAULT_BRANCH }],
  preventSelfReview: false,
  reviewers: [{ id: VIEWER_ID, type: "User" }],
  waitTimer: 0,
});

export const EMPTY_SETTINGS = (): Settings => ({
  rulesets: [],
  reporting: false,
  alerts: true,
  scanning: true,
  pushProtection: true,
  securityUpdates: true,
  description: null,
  homepage: null,
  topics: [],
  isPrivate: false,
  environment: null,
});

/** A fake `Gh` over a settings store. `fail` answers a call with a failure instead; every call is recorded. */
export type FakeGh = { gh: Gh; settings: Settings; calls: GhCall[]; writes: () => GhCall[] };

const ok = (value?: unknown): GhResult => ({ ok: true, stdout: value === undefined ? "" : JSON.stringify(value) });
const NOT_FOUND: GhFailure = { ok: false, kind: "http", status: 404, message: "gh: Not Found (HTTP 404)" };
const ID = /^repos\/[^/]+\/[^/]+\/rulesets\/(\d+)$/;
const ENVIRONMENT = "/environments/evals";
const POLICIES = `${ENVIRONMENT}/deployment-branch-policies`;
const POLICY_ID = /\/deployment-branch-policies\/(\d+)$/;

/** What GitHub serves for a stored ruleset: the body, the id, and fields it fills in itself. */
const served = (ruleset: Ruleset & { id: number }) => ({
  ...ruleset,
  node_id: `RRS_${ruleset.id}`,
  source: "fake/repo",
  source_type: "Repository",
  created_at: "2026-11-10T00:00:00Z",
  updated_at: "2026-11-10T00:00:00Z",
  _links: { self: { href: "https://api.github.com/x" } },
  rules: ruleset.rules.map((rule) =>
    rule.type === "pull_request" ? { ...rule, parameters: { ...rule.parameters, allowed_merge_methods: ["squash"] } } : rule,
  ),
});

type EnvironmentBody = {
  wait_timer: number;
  prevent_self_review: boolean;
  reviewers: { type: "User" | "Team"; id: number }[];
  deployment_branch_policy: { protected_branches: boolean; custom_branch_policies: boolean } | null;
};

/** PUT on the environment creates or replaces it; POST and DELETE add and drop its branch policies. */
function environmentWrite(settings: Settings, { method, path: sub, body }: GhCall): GhResult {
  if (method === "PUT" && sub === ENVIRONMENT) {
    const input = body as EnvironmentBody;
    const policy = input.deployment_branch_policy;
    const branches = policy === null ? "any" : policy.custom_branch_policies ? "custom" : "protected";
    settings.environment = {
      branches,
      policies: settings.environment?.policies ?? [],
      preventSelfReview: input.prevent_self_review,
      reviewers: input.reviewers,
      waitTimer: input.wait_timer,
    };
    return ok();
  }
  const environment = settings.environment;
  if (environment === null) return NOT_FOUND;
  if (method === "POST" && sub === POLICIES) {
    const created = { id: Math.max(0, ...environment.policies.map((policy) => policy.id)) + 1, name: (body as { name: string }).name };
    environment.policies.push(created);
    return ok({ ...created, node_id: `DBP_${created.id}`, type: "branch" });
  }
  const id = Number(POLICY_ID.exec(sub)?.[1]);
  environment.policies = environment.policies.filter((policy) => policy.id !== id);
  return ok();
}

/** What GitHub serves for the environment: its protection rules, branch policy and fields it fills in itself. */
function servedEnvironment({ branches, preventSelfReview, reviewers, waitTimer }: Environment) {
  const required = {
    id: 1,
    node_id: "GA_1",
    prevent_self_review: preventSelfReview,
    reviewers: reviewers.map(({ type, id }) => ({ type, reviewer: { id, login: `${type.toLowerCase()}-${id}` } })),
    type: "required_reviewers",
  };
  const rules = [
    ...(reviewers.length > 0 ? [required] : []),
    ...(waitTimer > 0 ? [{ id: 2, node_id: "GA_2", type: "wait_timer", wait_timer: waitTimer }] : []),
    ...(branches === "any" ? [] : [{ id: 3, node_id: "GA_3", type: "branch_policy" }]),
  ];
  const policy = branches === "any" ? null : { custom_branch_policies: branches === "custom", protected_branches: branches === "protected" };
  return { can_admins_bypass: true, deployment_branch_policy: policy, id: 7, name: "evals", protection_rules: rules };
}

function readEnvironment(environment: Environment | null, sub: string): GhResult {
  if (environment === null) return NOT_FOUND;
  if (sub === ENVIRONMENT) return ok(servedEnvironment(environment));
  const policies = environment.policies.map((policy) => ({ ...policy, node_id: `DBP_${policy.id}`, type: "branch" }));
  return ok({ branch_policies: policies, total_count: policies.length });
}

function write(settings: Settings, { method, path, body }: GhCall): GhResult {
  const base = path.split("/").slice(0, 3).join("/");
  const sub = path.slice(base.length);
  const id = ID.exec(path)?.[1];
  const input = body as Record<string, unknown> & Ruleset;
  if (method === "POST" && sub === "/rulesets") {
    const created = { ...input, id: settings.rulesets.length + 100 };
    settings.rulesets.push(created);
    return ok(served(created));
  }
  if (method === "PUT" && id !== undefined) {
    settings.rulesets = settings.rulesets.map((ruleset) => (ruleset.id === Number(id) ? { ...input, id: ruleset.id } : ruleset));
    return ok();
  }
  if (sub.startsWith(ENVIRONMENT)) return environmentWrite(settings, { method, path: sub, body });
  if (method === "PUT" && sub === "/private-vulnerability-reporting") settings.reporting = true;
  else if (method === "PUT" && sub === "/vulnerability-alerts") settings.alerts = true;
  else if (method === "PUT" && sub === "/automated-security-fixes") settings.securityUpdates = true;
  else if (method === "PUT" && sub === "/topics") settings.topics = (body as { names: string[] }).names;
  else if (method === "PATCH" && sub === "") {
    if (input.security_and_analysis !== undefined) {
      settings.scanning = true;
      settings.pushProtection = true;
    }
    settings.description = (input.description as string | undefined) ?? settings.description;
    settings.homepage = (input.homepage as string | undefined) ?? settings.homepage;
  }
  return ok();
}

function read(settings: Settings, path: string): GhResult {
  if (path === "user") return ok({ id: VIEWER_ID, login: "admin", type: "User" });
  const sub = path.split("/").slice(3).join("/");
  if (sub.startsWith(ENVIRONMENT.slice(1))) return readEnvironment(settings.environment, `/${sub}`);
  const id = ID.exec(path)?.[1];
  const found = settings.rulesets.find((ruleset) => ruleset.id === Number(id));
  if (id !== undefined) return found === undefined ? NOT_FOUND : ok(served(found));
  if (path.endsWith("/rulesets")) return ok(settings.rulesets.map(({ id: n, name }) => ({ id: n, name })));
  if (path.endsWith("/private-vulnerability-reporting")) return ok({ enabled: settings.reporting });
  if (path.endsWith("/vulnerability-alerts")) return settings.alerts ? ok() : NOT_FOUND;
  const { description, homepage, topics } = settings;
  const status = (on: boolean) => ({ status: on ? "enabled" : "disabled" });
  const security_and_analysis = {
    secret_scanning: status(settings.scanning),
    secret_scanning_push_protection: status(settings.pushProtection),
    dependabot_security_updates: status(settings.securityUpdates),
  };
  const owner = { login: "workerstack", type: "Organization" };
  const repo = { default_branch: DEFAULT_BRANCH, name: "repo", owner, private: settings.isPrivate };
  return ok({ ...repo, description, homepage, security_and_analysis, topics });
}

/** A fake gh over `initial` settings; `fail` may answer any call with a failure. */
export function fakeGh(initial: Settings = EMPTY_SETTINGS(), fail?: (call: GhCall) => GhFailure | undefined): FakeGh {
  const settings = initial;
  const calls: GhCall[] = [];
  const gh: Gh = async (call) => {
    calls.push(call);
    const failure = fail?.(call);
    if (failure !== undefined) return failure;
    return call.method === "GET" ? read(settings, call.path) : write(settings, call);
  };
  return { gh, settings, calls, writes: () => calls.filter((call) => call.method !== "GET") };
}
