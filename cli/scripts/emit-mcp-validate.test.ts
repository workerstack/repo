import fs from "node:fs";
import path from "node:path";

import { expect, it } from "vitest";

import { isRecord } from "../json.ts";
import { BASE_POLICY } from "./__fixtures__/mcp-base-policy.ts";
import { plantDirs, readJsonAs } from "./__fixtures__/mcp-policy-kit.ts";
import { loadPolicy, requiredDeepMatch, validatePolicy } from "./emit-mcp-validate.ts";
import { stripJsonc } from "./strip-jsonc.ts";

const tmpDir = plantDirs();
const repoRoot = path.resolve(import.meta.dirname, "..", "..");

it("rejects default !== deny and non-array allow", () => {
  expect(validatePolicy({ ...BASE_POLICY, default: "allow" }).ok).toBe(false);
  expect(validatePolicy({ ...BASE_POLICY, allow: "x" }).ok).toBe(false);
});

it("rejects a servers key, which moved to .mcp.json", () => {
  expect(validatePolicy({ ...BASE_POLICY, servers: {} })).toStrictEqual({
    error: "mcp-policy.jsonc: servers moved to .mcp.json; run `bun repo sync`",
    ok: false,
  });
});

it("repo SSOT allow is empty and not cloudflare/docker", () => {
  const policy = loadPolicy(repoRoot);
  expect(validatePolicy(policy).ok).toBe(true);
  expect(policy.allow).toStrictEqual([]);
  const names = (Array.isArray(policy.allow) ? policy.allow : []).map((n) => String(n).toLowerCase());
  expect(names).not.toContain("cloudflare");
  expect(names).not.toContain("docker");
  expect(stripJsonc(fs.readFileSync(path.join(repoRoot, "agents/mcp-policy.jsonc"), "utf8"))).toMatch(
    /"default"\s*:\s*"deny"/,
  );
});

it("every subagent has an inherit:false row, and validation holds implementers to it", () => {
  const policy = loadPolicy(repoRoot);
  const agents = isRecord(policy.agents) ? policy.agents : {};

  for (const id of ["orchestrator", "scout", "researcher", "implementer-fast", "implementer-deep"]) {
    expect(agents[id]).toStrictEqual({ inherit: false });
    const bad = { ...policy, agents: { ...agents, [id]: { inherit: true } } };
    expect(validatePolicy(bad)).toStrictEqual({ error: `agents.${id}.inherit must be false`, ok: false });
  }
});

it("skipKeyPattern still matches mcp(servers)?", () => {
  const manifest = readJsonAs<{ skipKeyPattern: string }>(repoRoot, "agents/global-settings/manifest.json");
  expect(manifest.skipKeyPattern).toMatch(/mcp\(servers\)\?/);
  const re = new RegExp(manifest.skipKeyPattern, "i");
  expect(re.test("mcp")).toBe(true);
  expect(re.test("mcpServers")).toBe(true);
});

const GROK_NO_MCP = /mcpInheritance:\s*none/;
const ANTIGRAVITY_NO_MCP = /inheritMcp:\s*false/;

/** Whether a subagent's grokcli or antigravity-cli block lacks the flag that keeps MCP from being inherited. */
function inheritsMcp(text: string): boolean {
  return (
    (text.includes("grokcli:") && !GROK_NO_MCP.test(text)) ||
    (text.includes("antigravity-cli:") && !ANTIGRAVITY_NO_MCP.test(text))
  );
}

it("subagent inherit flags stay none/false", () => {
  const dir = path.join(repoRoot, "agents/subagents");
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".md"));
  expect(files.length).toBeGreaterThan(0);
  const inheriting = files.filter((name) => inheritsMcp(fs.readFileSync(path.join(dir, name), "utf8")));
  expect(inheriting).toStrictEqual([]);
});

it("requiredDeepMatch allows extra disk keys", () => {
  expect(requiredDeepMatch({ a: 1, extra: true }, { a: 1 })).toBe(true);
  expect(requiredDeepMatch({ a: 2 }, { a: 1 })).toBe(false);
});

it("uses the stock policy alone when the consumer has none", () => {
  const stock = tmpDir("mcp-stock-");
  const consumer = tmpDir("mcp-consumer-");
  fs.mkdirSync(path.join(stock, "agents"), { recursive: true });
  fs.writeFileSync(path.join(stock, "agents/mcp-policy.jsonc"), `// fixture\n${JSON.stringify(BASE_POLICY)}\n`);
  expect(loadPolicy(stock, consumer)).toStrictEqual(loadPolicy(stock));
});
