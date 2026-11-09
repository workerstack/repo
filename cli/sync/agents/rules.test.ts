import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { HOSTS, type Host } from "../../config.ts";
import { readGoldens } from "../../../dev/capture-tree-goldens.ts";
import { renderRules } from "./rules.ts";
import { renderSubagents } from "./subagents.ts";
import { type Doc, type Sources, loadSources } from "./sources.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const FIXTURES = path.join(ROOT, "cli", "sync", "fixtures");

const isRulesPath = (rel: string) =>
  rel === "AGENTS.md" || rel.startsWith(".agents/rules/") || rel.startsWith(".claude/rules/") || rel.startsWith(".grok/rules/");

function unwrap(result: ReturnType<typeof loadSources>): Sources {
  if (!result.ok) throw new Error(result.problems.join("\n"));
  return result.sources;
}

function fixtureSources(): Sources {
  return unwrap(loadSources({ stockRoot: path.join(FIXTURES, "consumer-stock"), consumerRoot: path.join(FIXTURES, "consumer") }));
}

function rule(file: string, data: Record<string, unknown>, body: string, dir = ".repo"): Doc {
  return { rel: `${dir}/rules/${file}`, file, data: { description: "d", ...data }, body };
}

function sourcesOf(rules: Doc[]): Sources {
  return { rules, subagents: [], hooks: { rel: "agents/hooks.jsonc", value: {} } };
}

const BASE = rule("overview.md", {}, "Base body.", "agents");
const SCOPED = rule("testing.md", { paths: ["src/**", "lib/**"] }, "Test body.");

describe("renderRules", () => {
  it("matches the consumer fixture goldens byte for byte, path set included", () => {
    const goldens = new Map([...readGoldens()].filter(([rel]) => isRulesPath(rel)));
    const out = renderRules(fixtureSources(), HOSTS);
    expect([...out.keys()].sort()).toEqual([...goldens.keys()].sort());
    for (const [rel, text] of goldens) expect(out.get(rel), rel).toBe(text);
  });

  it("renders this repo's committed AGENTS.md from its stock alone", () => {
    const out = renderRules(unwrap(loadSources({ stockRoot: ROOT, consumerRoot: null })), HOSTS);
    expect(out.get("AGENTS.md")).toBe(fs.readFileSync(path.join(ROOT, "AGENTS.md"), "utf8"));
  });

  it("emits nothing with no host on", () => {
    expect(renderRules(fixtureSources(), []).size).toBe(0);
  });

  it("folds pathless rules into AGENTS.md in source order and writes no file for them", () => {
    const out = renderRules(sourcesOf([BASE, rule("b.md", {}, "B."), rule("a.md", {}, "A.")]), HOSTS);
    expect([...out.keys()]).toEqual(["AGENTS.md"]);
    expect(out.get("AGENTS.md")).toBe("Base body.\n\nB.\n\nA.\n");
  });

  it.each([[["**/*"]], [["*"]], [[]]])("treats paths %j as pathless", (paths) => {
    const out = renderRules(sourcesOf([BASE, rule("p.md", { paths }, "P.")]), HOSTS);
    expect([...out.keys()]).toEqual(["AGENTS.md"]);
    expect(out.get("AGENTS.md")).toBe("Base body.\n\nP.\n");
  });

  it("renders a path rule for claude with a paths list and nothing else", () => {
    const out = renderRules(sourcesOf([BASE, rule("testing.md", { paths: ["src/**", "lib/**"], overrides: "x" }, "Test body.")]), ["claude"]);
    expect(out.get(".claude/rules/testing.md")).toBe("---\npaths:\n  - src/**\n  - lib/**\n---\nTest body.\n");
    expect([...out.keys()].sort()).toEqual([".claude/rules/testing.md", "AGENTS.md"]);
  });

  it("renders a path rule for antigravity as a glob trigger", () => {
    const out = renderRules(sourcesOf([BASE, SCOPED]), ["antigravity"]);
    expect(out.get(".agents/rules/testing.md")).toBe("---\ntrigger: glob\nglobs: src/**,lib/**\n---\nTest body.\n");
    expect([...out.keys()].sort()).toEqual([".agents/rules/testing.md", "AGENTS.md"]);
  });

  it("keeps nested rule paths", () => {
    const out = renderRules(sourcesOf([BASE, rule("x/y.md", { paths: ["x/**"] }, "Y.")]), ["claude", "antigravity"]);
    expect(out.has(".claude/rules/x/y.md")).toBe(true);
    expect(out.has(".agents/rules/x/y.md")).toBe(true);
  });

  it.each<Host>(["codex", "grok", "cursor"])("lists a path rule in AGENTS.md when %s is on, without a rule file", (host) => {
    const out = renderRules(sourcesOf([BASE, SCOPED]), [host]);
    expect([...out.keys()]).toEqual(["AGENTS.md"]);
    expect(out.get("AGENTS.md")).toBe("Base body.\n\n## Rules by path\n- `src/** lib/**`: read `.repo/rules/testing.md`\n");
  });

  it("points a stock path rule into the installed package", () => {
    const stock = rule("style.md", { paths: ["**/*.ts"] }, "S.", "agents");
    const out = renderRules(sourcesOf([BASE, stock]), ["codex"]);
    expect(out.get("AGENTS.md")).toContain("- `**/*.ts`: read `node_modules/@workerstack/repo/agents/rules/style.md`\n");
  });

  it("leaves the pointer list out when only claude or antigravity is on", () => {
    for (const host of ["claude", "antigravity"] as const) {
      expect(renderRules(sourcesOf([BASE, SCOPED]), [host]).get("AGENTS.md")).toBe("Base body.\n");
    }
  });

  it("leaves the pointer list out when no rule has paths", () => {
    expect(renderRules(sourcesOf([BASE]), ["codex"]).get("AGENTS.md")).toBe("Base body.\n");
  });

  it("writes no .grok/rules for any host set", () => {
    expect([...renderRules(sourcesOf([BASE, SCOPED]), HOSTS).keys()].filter((rel) => rel.startsWith(".grok/"))).toEqual([]);
  });

  it("lists every path rule once, in source order", () => {
    const out = renderRules(sourcesOf([BASE, SCOPED, rule("b.md", { paths: ["b/**"] }, "B.")]), HOSTS);
    const list = out.get("AGENTS.md")!.split("## Rules by path\n")[1]!;
    expect(list).toBe("- `src/** lib/**`: read `.repo/rules/testing.md`\n- `b/**`: read `.repo/rules/b.md`\n");
  });
});

describe("overrides in rendered output", () => {
  it("is stripped from every host's subagent file", () => {
    const scout: Doc = {
      rel: ".repo/subagents/scout.md",
      file: "scout.md",
      data: { name: "scout", description: "Scout.", overrides: "scout" },
      body: "Body.",
    };
    const out = renderSubagents({ ...sourcesOf([]), subagents: [scout] }, HOSTS);
    expect(out.size).toBe(HOSTS.length);
    for (const [rel, text] of out) expect(text, rel).not.toContain("overrides");
  });
});
