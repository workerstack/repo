import type { Gh, GhCall, GhFailure, GhResult } from "../github-gh.ts";
import type { Ruleset } from "../github.types.ts";

/** What the fake GitHub holds; `repo github` reads and writes it through the same paths the API has. */
export type Settings = {
  rulesets: (Ruleset & { id: number })[];
  reporting: boolean;
  alerts: boolean;
  description: string | null;
  homepage: string | null;
  topics: string[];
};

export const EMPTY_SETTINGS = (): Settings => ({
  rulesets: [],
  reporting: false,
  alerts: true,
  description: null,
  homepage: null,
  topics: [],
});

/** A fake `Gh` over a settings store. `fail` answers a call with a failure instead; every call is recorded. */
export type FakeGh = { gh: Gh; settings: Settings; calls: GhCall[]; writes: () => GhCall[] };

const ok = (value?: unknown): GhResult => ({ ok: true, stdout: value === undefined ? "" : JSON.stringify(value) });
const NOT_FOUND: GhFailure = { ok: false, kind: "http", status: 404, message: "gh: Not Found (HTTP 404)" };
const ID = /^repos\/[^/]+\/[^/]+\/rulesets\/(\d+)$/;

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
  if (method === "PUT" && sub === "/private-vulnerability-reporting") settings.reporting = true;
  else if (method === "PUT" && sub === "/vulnerability-alerts") settings.alerts = true;
  else if (method === "PUT" && sub === "/topics") settings.topics = (body as { names: string[] }).names;
  else if (method === "PATCH" && sub === "") {
    settings.description = (input.description as string | undefined) ?? settings.description;
    settings.homepage = (input.homepage as string | undefined) ?? settings.homepage;
  }
  return ok();
}

function read(settings: Settings, path: string): GhResult {
  const id = ID.exec(path)?.[1];
  const found = settings.rulesets.find((ruleset) => ruleset.id === Number(id));
  if (id !== undefined) return found === undefined ? NOT_FOUND : ok(served(found));
  if (path.endsWith("/rulesets")) return ok(settings.rulesets.map(({ id: n, name }) => ({ id: n, name })));
  if (path.endsWith("/private-vulnerability-reporting")) return ok({ enabled: settings.reporting });
  if (path.endsWith("/vulnerability-alerts")) return settings.alerts ? ok() : NOT_FOUND;
  const { description, homepage, topics } = settings;
  return ok({ description, homepage, topics, name: "repo", private: false });
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
