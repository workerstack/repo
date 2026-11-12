import { TomlDate } from "smol-toml";
import { afterEach, expect, it, vi } from "vitest";

import type { JsonObject } from "../json.ts";
import { DENY_ALL, plant, plantDirs, plantPolicy } from "./__fixtures__/mcp-policy-kit.ts";
import { isHomeGrokConfig } from "./emit-mcp-hosts.ts";
import { loadPolicy, requiredDeepMatch, validatePolicy } from "./emit-mcp-validate.ts";

const tmp = plantDirs();

afterEach(() => vi.restoreAllMocks());

function withPatch(patch: JsonObject) {
  return { ...DENY_ALL, ...patch };
}

it.each([
  ["is not an object", null, "invalid policy"],
  ["is a list", [], "invalid policy"],
  ["has a non-string allow name", withPatch({ allow: [1] }), "allow names must be non-empty strings"],
  ["has an empty allow name", withPatch({ allow: [""] }), "allow names must be non-empty strings"],
  [
    "keeps a servers key, even an empty one",
    withPatch({ servers: {} }),
    "mcp-policy.jsonc: servers moved to .mcp.json; run `bun repo sync`",
  ],
  ["has agents that are not an object", withPatch({ agents: [] }), "agents must be an object"],
  [
    "has an agent row that is not an object",
    withPatch({ agents: { scout: "x" } }),
    "agents.scout.inherit must be false",
  ],
  [
    "has an agent row that inherits",
    withPatch({ agents: { researcher: { inherit: true } } }),
    "agents.researcher.inherit must be false",
  ],
])("validatePolicy: rejects a policy that %s", (_name, policy, error) => {
  expect(validatePolicy(policy)).toStrictEqual({ error, ok: false });
});

it("validatePolicy: accepts allow names, whose servers are in .mcp.json, and unknown agent ids", () => {
  expect(validatePolicy(withPatch({ allow: ["a"] }))).toStrictEqual({ ok: true });
  expect(validatePolicy(withPatch({ agents: { other: { inherit: true }, scout: { inherit: false } } }))).toStrictEqual({
    ok: true,
  });
});

it("requiredDeepMatch: compares lists element by element and scalars by value", () => {
  expect(requiredDeepMatch(["a", "b"], ["a", "b"])).toBe(true);
  expect(requiredDeepMatch(["a"], ["a", "b"])).toBe(false);
  expect(requiredDeepMatch(1, 1)).toBe(true);
  expect(requiredDeepMatch(1, 2)).toBe(false);
  expect(requiredDeepMatch("1", 1)).toBe(false);
});

it("requiredDeepMatch: matches nested lists, objects and nulls inside lists", () => {
  expect(requiredDeepMatch([{ a: 1 }, null], [{ a: 1 }, null])).toBe(true);
  expect(requiredDeepMatch([{ a: 1 }], [{ a: 1, b: 2 }])).toBe(false);
  expect(requiredDeepMatch([{ a: 1 }], [{ a: 2 }])).toBe(false);
  expect(requiredDeepMatch([{ a: 1 }], [{ b: 1 }])).toBe(false);
  expect(requiredDeepMatch([null], [{}])).toBe(false);
  expect(requiredDeepMatch([[1]], [{}])).toBe(false);
  expect(requiredDeepMatch([{}], [[1]])).toBe(false);
  expect(requiredDeepMatch([[1]], [[1, 2]])).toBe(false);
});

it("requiredDeepMatch: does not treat dates as plain objects", () => {
  expect(requiredDeepMatch([new TomlDate(new Date(1))], [new TomlDate(new Date(2))])).toBe(false);
});

it("requiredDeepMatch: requires an object on disk when the desired value is an object", () => {
  expect(requiredDeepMatch("x", { a: 1 })).toBe(false);
  expect(requiredDeepMatch({ a: 1, extra: 2 }, { a: 1 })).toBe(true);
  expect(requiredDeepMatch({ a: 2 }, { a: 1 })).toBe(false);
});

it("isHomeGrokConfig: is false without a workspace or a home, true only for the same root", () => {
  expect(isHomeGrokConfig(undefined, "/h")).toBe(false);
  expect(isHomeGrokConfig("/w", undefined)).toBe(false);
  expect(isHomeGrokConfig("/w", "/h")).toBe(false);
  expect(isHomeGrokConfig("/h", "/h")).toBe(true);
});

it("loadPolicy: reads the stock policy from the process cwd when no source root is given", () => {
  const ws = tmp("mcp-load-");
  plantPolicy(ws, DENY_ALL);
  vi.spyOn(process, "cwd").mockReturnValue(ws);
  expect(loadPolicy()).toMatchObject({ allow: [], default: "deny" });
});

it.each([
  ["a list", "[]"],
  ["null", "null"],
])("loadPolicy: rejects a policy file holding %s", (_name, body) => {
  const ws = tmp("mcp-load-bad-");
  plant(ws, "agents/mcp-policy.jsonc", body);
  expect(() => loadPolicy(ws)).toThrow("invalid policy");
});

it("loadPolicy: merges objects key by key and replaces lists from the consumer policy", () => {
  const ws = tmp("mcp-load-src-");
  plantPolicy(ws, { ...DENY_ALL, agents: { scout: { inherit: false } }, allow: ["a"] });
  const consumer = tmp("mcp-load-own-");
  plant(consumer, ".repo/mcp-policy.jsonc", `{ "allow": ["b"], "agents": { "orchestrator": { "inherit": false } } }`);
  expect(loadPolicy(ws, consumer)).toMatchObject({
    agents: { orchestrator: { inherit: false }, scout: { inherit: false } },
    allow: ["b"],
    plugins: { denyDefault: true },
  });
});
