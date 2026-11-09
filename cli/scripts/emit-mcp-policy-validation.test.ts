import { afterEach, expect, it, vi } from "vitest";
import { isHomeGrokConfig, loadPolicy, requiredDeepMatch, validatePolicy } from "./emit-mcp-policy.ts";
import { DENY_ALL, plant, plantDirs, plantPolicy } from "./fixtures/mcp-policy-kit.ts";

const tmp = plantDirs();

afterEach(() => vi.restoreAllMocks());

const withPatch = (patch: Record<string, unknown>) => ({ ...DENY_ALL, ...patch });

it.each([
  ["is not an object", null, "invalid policy"],
  ["is a list", [], "invalid policy"],
  ["has a non-string allow name", withPatch({ allow: [1] }), "allow names must be non-empty strings"],
  ["has an empty allow name", withPatch({ allow: [""] }), "allow names must be non-empty strings"],
  ["has servers that are not an object", withPatch({ servers: [] }), "servers must be an object"],
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
  expect(validatePolicy(policy)).toEqual({ ok: false, error });
});

it("validatePolicy: accepts servers null, allow names without a servers table, and unknown agent ids", () => {
  expect(validatePolicy(withPatch({ servers: null, allow: ["a"] }))).toEqual({ ok: true });
  expect(validatePolicy(withPatch({ servers: {}, allow: ["a"] }))).toEqual({ ok: true });
  expect(validatePolicy(withPatch({ agents: { other: { inherit: true }, scout: { inherit: false } } }))).toEqual({
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
  expect(requiredDeepMatch([new Date(1)], [new Date(2)])).toBe(false);
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
  expect(loadPolicy()).toMatchObject({ default: "deny", allow: [] });
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
  plantPolicy(ws, { ...DENY_ALL, allow: ["a"], servers: { a: { url: "u" } } });
  const consumer = tmp("mcp-load-own-");
  plant(consumer, ".repo/mcp-policy.jsonc", `{ "allow": ["b"], "servers": { "b": { "url": "v" } } }`);
  expect(loadPolicy(ws, consumer)).toMatchObject({
    allow: ["b"],
    servers: { a: { url: "u" }, b: { url: "v" } },
    plugins: { denyDefault: true },
  });
});
