import fs from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";
import { isPlainObject, loadPolicy, requiredDeepMatch, validatePolicy } from "./emit-mcp-validate.ts";
import { plantDirs, readJsonAs } from "./fixtures/mcp-policy-kit.ts";
import { stripJsonc } from "./jsonc.ts";

const tmpDir = plantDirs();
const repoRoot = path.resolve(import.meta.dirname, "..", "..");
const NO_SERVERS: string[] = [];
const basePolicy = {
  default: "deny",
  allow: NO_SERVERS,
  plugins: { denyDefault: true },
  agents: { orchestrator: { inherit: false }, repo: { inherit: false } },
};

it("rejects default !== deny and non-array allow", () => {
  expect(validatePolicy({ ...basePolicy, default: "allow" }).ok).toBe(false);
  expect(validatePolicy({ ...basePolicy, allow: "x" }).ok).toBe(false);
});

it("rejects a servers key, which moved to .mcp.json", () => {
  expect(validatePolicy({ ...basePolicy, servers: {} })).toStrictEqual({
    ok: false,
    error: "mcp-policy.jsonc: servers moved to .mcp.json; run `bun repo sync`",
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
  const agents = isPlainObject(policy.agents) ? policy.agents : {};
  for (const id of ["orchestrator", "scout", "researcher", "implementer-fast", "implementer-deep"]) {
    expect(agents[id]).toStrictEqual({ inherit: false });
    const bad = { ...policy, agents: { ...agents, [id]: { inherit: true } } };
    expect(validatePolicy(bad)).toStrictEqual({ ok: false, error: `agents.${id}.inherit must be false` });
  }
});

it("skipKeyPattern still matches mcp(servers)?", () => {
  const manifest = readJsonAs<{ skipKeyPattern: string }>(repoRoot, "agents/global-settings/manifest.json");
  expect(manifest.skipKeyPattern).toMatch(/mcp\(servers\)\?/);
  const re = new RegExp(manifest.skipKeyPattern, "i");
  expect(re.test("mcp")).toBe(true);
  expect(re.test("mcpServers")).toBe(true);
});

it("subagent inherit flags stay none/false", () => {
  const dir = path.join(repoRoot, "agents/subagents");
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".md"));
  expect(files.length).toBeGreaterThan(0);
  for (const name of files) {
    const text = fs.readFileSync(path.join(dir, name), "utf8");
    if (text.includes("grokcli:")) expect(text).toMatch(/mcpInheritance:\s*none/);
    if (text.includes("antigravity-cli:")) expect(text).toMatch(/inheritMcp:\s*false/);
  }
});

it("requiredDeepMatch allows extra disk keys", () => {
  expect(requiredDeepMatch({ a: 1, extra: true }, { a: 1 })).toBe(true);
  expect(requiredDeepMatch({ a: 2 }, { a: 1 })).toBe(false);
});

it("isPlainObject takes a record and rejects null, arrays and TOML dates", () => {
  expect(isPlainObject({ a: 1 })).toBe(true);
  expect(isPlainObject(null)).toBe(false);
  expect(isPlainObject([])).toBe(false);
  expect(isPlainObject(new Date(0))).toBe(false);
});

it("uses the stock policy alone when the consumer has none", () => {
  const stock = tmpDir("mcp-stock-");
  const consumer = tmpDir("mcp-consumer-");
  fs.mkdirSync(path.join(stock, "agents"), { recursive: true });
  fs.writeFileSync(path.join(stock, "agents/mcp-policy.jsonc"), `// fixture\n${JSON.stringify(basePolicy)}\n`);
  expect(loadPolicy(stock, consumer)).toStrictEqual(loadPolicy(stock));
});
