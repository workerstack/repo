import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { regionBody } from "../region.ts";
import { HOSTS, type Host } from "../../config.ts";
import { readGoldens } from "../../../dev/capture-tree-goldens.ts";
import { renderRules } from "./rules.ts";
import { renderSubagents } from "./subagents.ts";
import { type Doc, type Sources, loadSources } from "./sources.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const FIXTURES = path.join(ROOT, "cli", "sync", "fixtures");

const isRulesPath = (rel: string) => rel === "AGENTS.md" || /^\.(?:agents|claude|grok)\/rules\//.test(rel);

function fixtureSources(): Sources {
  return loadSources({
    stockRoot: path.join(FIXTURES, "consumer-stock"),
    consumerRoot: path.join(FIXTURES, "consumer"),
    packages: [],
  }).sources;
}

function rule(file: string, data: Record<string, unknown>, body: string, dir = ".repo"): Doc {
  return {
    rel: `${dir}/rules/${file}`,
    file,
    origin: dir === "agents" ? "stock" : "repo",
    scope: "",
    data: { description: "d", ...data },
    body,
  };
}

function sourcesOf(rules: Doc[]): Sources {
  return { rules, subagents: [], hooks: { rel: "agents/hooks.jsonc", value: {} } };
}

/** The text of every file `renderRules` plans for the root scope, or for `scope`. */
function renderText(sources: Sources, hosts: readonly Host[], scope = ""): Map<string, string> {
  return new Map([...renderRules(sources.rules, hosts, scope)].map(([rel, file]) => [rel, file.text]));
}

/** What `renderRules` plans for a written file: the body of an `AGENTS.md` region, any other file whole. */
const bodyOf = (rel: string, text: string) =>
  rel.endsWith("AGENTS.md") ? `${regionBody(text, "<!--", "rules")}\n` : text;

const BASE = rule("overview.md", {}, "Base body.", "agents");
const SCOPED = rule("testing.md", { paths: ["src/**", "lib/**"] }, "Test body.");

describe("renderRules", () => {
  it("matches the consumer fixture goldens byte for byte, path set included", () => {
    const goldens = new Map([...readGoldens()].filter(([rel]) => isRulesPath(rel)));
    const out = renderText(fixtureSources(), HOSTS);
    expect([...out.keys()].sort()).toEqual([...goldens.keys()].sort());
    for (const [rel, text] of goldens) expect(out.get(rel), rel).toBe(bodyOf(rel, text));
  });

  it("renders this repo's committed AGENTS.md from its stock alone, in its repo:rules region", () => {
    const out = renderText(loadSources({ stockRoot: ROOT, consumerRoot: null, packages: [] }).sources, HOSTS);
    expect(out.get("AGENTS.md")).toBe(bodyOf("AGENTS.md", fs.readFileSync(path.join(ROOT, "AGENTS.md"), "utf8")));
  });

  it("emits nothing with no host on", () => {
    expect(renderText(fixtureSources(), []).size).toBe(0);
  });

  it("folds stock pathless rules into AGENTS.md in source order and writes no file for them", () => {
    const stock = [BASE, rule("b.md", {}, "B.", "agents"), rule("a.md", {}, "A.", "agents")];
    expect(Object.fromEntries(renderText(sourcesOf(stock), HOSTS))).toEqual({
      "AGENTS.md": "Base body.\n\nB.\n\nA.\n",
    });
  });

  it("renders a repo pathless rule only when it overrides a stock one, where that was, and lists path rules", () => {
    const over = rule("overview.md", { overrides: "overview" }, "Mine instead.");
    const rules = [over, rule("b.md", {}, "B.", "agents"), rule("mine.md", {}, "Mine."), SCOPED];
    expect(Object.fromEntries(renderText(sourcesOf(rules), ["codex"]))).toEqual({
      "AGENTS.md": "Mine instead.\n\nB.\n\n## Rules by path\n- `src/** lib/**`: read `.repo/rules/testing.md`\n",
    });
  });

  it.each([[["**/*"]], [["*"]], [[]]])("treats paths %j as pathless", (paths) => {
    const out = renderText(sourcesOf([BASE, rule("p.md", { paths }, "P.", "agents")]), HOSTS);
    expect([...out.keys()]).toEqual(["AGENTS.md"]);
    expect(out.get("AGENTS.md")).toBe("Base body.\n\nP.\n");
  });

  it("renders a path rule for claude with a paths list and nothing else", () => {
    const out = renderText(
      sourcesOf([BASE, rule("testing.md", { paths: ["src/**", "lib/**"], overrides: "x" }, "Test body.")]),
      ["claude"],
    );
    expect(out.get(".claude/rules/testing.md")).toBe("---\npaths:\n  - src/**\n  - lib/**\n---\nTest body.\n");
    expect([...out.keys()].sort()).toEqual([".claude/rules/testing.md", "AGENTS.md"]);
  });

  it("renders a path rule for antigravity as a glob trigger", () => {
    const out = renderText(sourcesOf([BASE, SCOPED]), ["antigravity"]);
    expect(out.get(".agents/rules/testing.md")).toBe("---\ntrigger: glob\nglobs: src/**,lib/**\n---\nTest body.\n");
    expect([...out.keys()].sort()).toEqual([".agents/rules/testing.md", "AGENTS.md"]);
  });

  it("keeps nested rule paths", () => {
    const out = renderText(sourcesOf([BASE, rule("x/y.md", { paths: ["x/**"] }, "Y.")]), ["claude", "antigravity"]);
    expect(out.has(".claude/rules/x/y.md")).toBe(true);
    expect(out.has(".agents/rules/x/y.md")).toBe(true);
  });

  it.each<Host>(["codex", "grok", "cursor"])(
    "lists a path rule in AGENTS.md when %s is on, without a rule file",
    (host) => {
      const out = renderText(sourcesOf([BASE, SCOPED]), [host]);
      expect([...out.keys()]).toEqual(["AGENTS.md"]);
      expect(out.get("AGENTS.md")).toBe(
        "Base body.\n\n## Rules by path\n- `src/** lib/**`: read `.repo/rules/testing.md`\n",
      );
    },
  );

  it("points a stock path rule into the installed package", () => {
    const stock = rule("style.md", { paths: ["**/*.ts"] }, "S.", "agents");
    const out = renderText(sourcesOf([BASE, stock]), ["codex"]);
    expect(out.get("AGENTS.md")).toContain(
      "- `**/*.ts`: read `node_modules/@workerstack/repo/agents/rules/style.md`\n",
    );
  });

  it("leaves the pointer list out when only claude or antigravity is on", () => {
    for (const host of ["claude", "antigravity"] as const) {
      expect(renderText(sourcesOf([BASE, SCOPED]), [host]).get("AGENTS.md")).toBe("Base body.\n");
    }
  });

  it("leaves the pointer list out when no rule has paths", () => {
    expect(renderText(sourcesOf([BASE]), ["codex"]).get("AGENTS.md")).toBe("Base body.\n");
  });

  it("writes no .grok/rules for any host set", () => {
    expect([...renderText(sourcesOf([BASE, SCOPED]), HOSTS).keys()].filter((rel) => rel.startsWith(".grok/"))).toEqual(
      [],
    );
  });

  it("lists every path rule once, in source order", () => {
    const out = renderText(sourcesOf([BASE, SCOPED, rule("b.md", { paths: ["b/**"] }, "B.")]), HOSTS);
    const list = out.get("AGENTS.md")!.split("## Rules by path\n")[1]!;
    expect(list).toBe("- `src/** lib/**`: read `.repo/rules/testing.md`\n- `b/**`: read `.repo/rules/b.md`\n");
  });
});

describe("overrides in rendered output", () => {
  it("is stripped from every host's subagent file", () => {
    const scout: Doc = {
      rel: ".repo/subagents/scout.md",
      file: "scout.md",
      origin: "repo",
      scope: "",
      data: { name: "scout", description: "Scout.", overrides: "scout" },
      body: "Body.",
    };
    const out = renderSubagents({ ...sourcesOf([]), subagents: [scout] }, HOSTS);
    expect(out.size).toBe(HOSTS.length);
    for (const [rel, text] of out) expect(text, rel).not.toContain("overrides");
  });
});

describe("renderRules for a package scope", () => {
  const WEB = "packages/web";
  const pkgRule = (file: string, data: Record<string, unknown>, body: string): Doc => ({
    rel: `${WEB}/.repo/rules/${file}`,
    file,
    origin: "repo",
    scope: WEB,
    data: { description: "d", ...data },
    body,
  });
  const POINTER = "Start at references/INDEX.md in this package.";
  const COMPONENTS = pkgRule("components.md", {}, "Components live in src/components and use the ui kit.");
  const API = pkgRule("api.md", { paths: ["src/api/**"] }, "Api body.");
  const sources = sourcesOf([BASE, SCOPED, COMPONENTS, API]);

  it("writes the package AGENTS.md: the pointer line, then a pointer per path rule, and none of its pathless rules", () => {
    const out = renderText(sources, ["codex"], WEB);
    expect(out.get(`${WEB}/AGENTS.md`)).toBe(
      `${POINTER}\n\n## Rules by path\n- \`packages/web/src/api/**\`: read \`packages/web/.repo/rules/api.md\`\n`,
    );
    expect([...out.keys()]).toEqual([`${WEB}/AGENTS.md`]);
  });

  it("leaves the pointer list out when no host that needs it is on, writes no CLAUDE.md, and the root AGENTS.md has no package rule", () => {
    expect(renderText(sources, ["claude"], WEB).get(`${WEB}/AGENTS.md`)).toBe(`${POINTER}\n`);
    expect([...renderText(sources, HOSTS, WEB).keys()].filter((rel) => rel.includes("CLAUDE"))).toEqual([]);
    const root = renderText(sources, HOSTS, "");
    for (const [rel, text] of root) expect(`${rel}\n${text}`, rel).not.toMatch(/Components live|packages\/web/);
  });

  it("renders every package rule for claude under its dir, a pathless one scoped to the whole package", () => {
    const out = renderText(sources, ["claude"], WEB);
    expect(out.get(".claude/rules/packages/web/components.md")).toBe(
      "---\npaths:\n  - packages/web/**\n---\nComponents live in src/components and use the ui kit.\n",
    );
    expect(out.get(".claude/rules/packages/web/api.md")).toBe(
      "---\npaths:\n  - packages/web/src/api/**\n---\nApi body.\n",
    );
  });

  it("renders every package rule for antigravity under its dir as a glob trigger", () => {
    const out = renderText(pkgSources(), ["antigravity"], WEB);
    expect(out.get(".agents/rules/packages/web/components.md")).toBe(
      "---\ntrigger: glob\nglobs: packages/web/**\n---\nComponents live in src/components and use the ui kit.\n",
    );
    expect(out.get(".agents/rules/packages/web/multi.md")).toBe(
      "---\ntrigger: glob\nglobs: packages/web/a/**,packages/web/b/**\n---\nM.\n",
    );
  });

  function pkgSources(): Sources {
    return sourcesOf([COMPONENTS, pkgRule("multi.md", { paths: ["a/**", "b/**"] }, "M.")]);
  }

  it("names the rule file's source, and renders a package without rules as the pointer line", () => {
    const rendered = renderRules(sources.rules, ["claude"], WEB);
    expect(rendered.get(".claude/rules/packages/web/api.md")?.source).toBe(`${WEB}/.repo/rules/api.md`);
    expect(renderText(sources, ["claude"], "packages/empty").get("packages/empty/AGENTS.md")).toBe(`${POINTER}\n`);
  });

  it("emits nothing with no host on", () => {
    expect(renderRules(sources.rules, [], WEB).size).toBe(0);
  });
});
