import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { HOSTS, type Host } from "../../config.ts";
import { readGoldens } from "../../../dev/capture-tree-goldens.ts";
import { renderRules } from "./rules.ts";
import { type Doc, type Sources, loadSources } from "./sources.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const FIXTURES = path.join(ROOT, "cli", "sync", "fixtures");

const isRulesPath = (rel: string) => rel === "AGENTS.md" || rel.startsWith(".agents/rules/") || rel.startsWith(".grok/rules/");

function fixtureSources(): Sources {
  return loadSources({ stockRoot: path.join(FIXTURES, "consumer-stock"), consumerRoot: path.join(FIXTURES, "consumer") });
}

function rule(file: string, data: Record<string, unknown>, body: string): Doc {
  return { rel: `.repo/rules/${file}`, file, data, body };
}

function sourcesOf(rules: Doc[]): Sources {
  return { rules, subagents: [], hooks: { rel: "agents/hooks.jsonc", value: {} } };
}

const ROOT_RULE = rule("overview.md", { root: true }, "Root body.");

describe("renderRules", () => {
  it("matches the consumer fixture goldens byte for byte, path set included", () => {
    const goldens = new Map([...readGoldens()].filter(([rel]) => isRulesPath(rel)));
    const out = renderRules(fixtureSources(), HOSTS);
    expect([...out.keys()].sort()).toEqual([...goldens.keys()].sort());
    for (const [rel, text] of goldens) expect(out.get(rel), rel).toBe(text);
  });

  it("renders this repo's committed AGENTS.md from its stock alone", () => {
    const out = renderRules(loadSources({ stockRoot: ROOT, consumerRoot: null }), HOSTS);
    expect(out.get("AGENTS.md")).toBe(fs.readFileSync(path.join(ROOT, "AGENTS.md"), "utf8"));
  });

  it("emits nothing with no host on", () => {
    expect(renderRules(fixtureSources(), []).size).toBe(0);
  });

  it.each<Host[]>([["claude"], ["codex"], ["cursor"]])("emits only AGENTS.md for %s", (host) => {
    const out = renderRules(fixtureSources(), [host]);
    expect([...out.keys()]).toEqual(["AGENTS.md"]);
  });

  it("emits .agents/rules only with antigravity and .grok/rules only with grok", () => {
    expect([...renderRules(fixtureSources(), ["antigravity"]).keys()].sort()).toEqual([".agents/rules/testing.md", "AGENTS.md"]);
    expect([...renderRules(fixtureSources(), ["grok"]).keys()].sort()).toEqual([".grok/rules/testing.md", "AGENTS.md"]);
  });

  it("filters by targets: agentsmd and codexcli fold, other hosts' targets do not", () => {
    const rules = [
      ROOT_RULE,
      rule("a.md", { targets: ["agentsmd"] }, "A."),
      rule("b.md", { targets: ["codexcli"] }, "B."),
      rule("c.md", { targets: ["grokcli"] }, "C."),
      rule("d.md", { targets: ["antigravity-cli"] }, "D."),
      rule("e.md", { targets: ["claudecode"] }, "E."),
      rule("f.md", {}, "F."),
    ];
    const out = renderRules(sourcesOf(rules), HOSTS);
    expect(out.get("AGENTS.md")).toBe("Root body.\n\nA.\n\nB.\n\nF.\n");
    expect([...out.keys()].sort()).toEqual([
      ".agents/rules/d.md",
      ".agents/rules/f.md",
      ".grok/rules/c.md",
      ".grok/rules/f.md",
      "AGENTS.md",
    ]);
    expect(out.get(".grok/rules/c.md")).toBe("C.\n");
  });

  it("puts every root before the non-roots and keeps nested paths", () => {
    const rules = [rule("a.md", {}, "Non-root."), ROOT_RULE, rule("x/y.md", { root: true }, "Second root.")];
    const out = renderRules(sourcesOf(rules), ["antigravity", "grok"]);
    expect(out.get("AGENTS.md")).toBe("Root body.\n\nSecond root.\n\nNon-root.\n");
    expect(out.has(".agents/rules/x/y.md")).toBe(false);
    expect(out.get(".grok/rules/a.md")).toBe("Non-root.\n");
  });

  it("picks the antigravity trigger as rulesync did", () => {
    const rules = [
      ROOT_RULE,
      rule("glob.md", { globs: ["src/**", "lib/**"] }, "G."),
      rule("star.md", { globs: ["**/*", "src/**"] }, "S."),
      rule("desc.md", { description: "Only a description" }, "D."),
      rule("manual.md", { antigravity: { trigger: "manual" } }, "M."),
      rule("model.md", { description: "Pick me", antigravity: { trigger: "model_decision" } }, "Mo."),
      rule("stored.md", { globs: ["a/**"], antigravity: { trigger: "glob", globs: ["b/**", "c/**"] } }, "St."),
      rule("other.md", { antigravity: { trigger: "custom", extra: "x" } }, "O."),
    ];
    const out = renderRules(sourcesOf(rules), ["antigravity"]);
    expect(out.get(".agents/rules/glob.md")).toBe("---\ntrigger: glob\nglobs: src/**,lib/**\n---\nG.\n");
    expect(out.get(".agents/rules/star.md")).toBe("---\ntrigger: always_on\n---\nS.\n");
    expect(out.get(".agents/rules/desc.md")).toBe("---\ntrigger: always_on\n---\nD.\n");
    expect(out.get(".agents/rules/manual.md")).toBe("---\ntrigger: manual\n---\nM.\n");
    expect(out.get(".agents/rules/model.md")).toBe("---\ntrigger: model_decision\ndescription: Pick me\n---\nMo.\n");
    expect(out.get(".agents/rules/stored.md")).toBe("---\ntrigger: glob\nglobs: b/**,c/**\n---\nSt.\n");
    expect(out.get(".agents/rules/other.md")).toBe("---\ntrigger: custom\nextra: x\n---\nO.\n");
  });

  it("reads comma-separated glob strings and falls back to manual for a non-string trigger", () => {
    const rules = [
      ROOT_RULE,
      rule("str.md", { globs: "src/**, lib/**" }, "S."),
      rule("blank.md", { globs: "  " }, "B."),
      rule("stored.md", { antigravity: { trigger: "glob", globs: "x/**,y/**" } }, "St."),
      rule("num.md", { antigravity: { trigger: 5 } }, "N."),
      rule("bare.md", { antigravity: { trigger: "glob", globs: [] } }, "G."),
    ];
    const out = renderRules(sourcesOf(rules), ["antigravity"]);
    expect(out.get(".agents/rules/str.md")).toBe("---\ntrigger: glob\nglobs: src/**,lib/**\n---\nS.\n");
    expect(out.get(".agents/rules/blank.md")).toBe("---\ntrigger: always_on\n---\nB.\n");
    expect(out.get(".agents/rules/stored.md")).toBe("---\ntrigger: glob\nglobs: x/**,y/**\n---\nSt.\n");
    expect(out.get(".agents/rules/num.md")).toBe("---\ntrigger: manual\n---\nN.\n");
    expect(out.get(".agents/rules/bare.md")).toBe("---\ntrigger: glob\n---\nG.\n");
  });
});
