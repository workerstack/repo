import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { expect, it } from "vitest";

import { readGoldens } from "../../../dev/capture-tree-goldens.ts";
import { HOSTS, type Host } from "../../config.ts";
import { BASE, renderText, SCOPED, rule, sourcesOf, stockRule } from "../__fixtures__/rules-kit.ts";
import { regionBody } from "../region.ts";
import { loadSources } from "./load-sources.ts";
import type { Doc, Sources } from "./sources.types.ts";
import { renderSubagents } from "./subagents.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const FIXTURES = path.join(ROOT, "cli", "sync", "__fixtures__");

function isRulesPath(rel: string) {
  return rel === "AGENTS.md" || /^\.(?:agents|claude|grok)\/rules\//.test(rel);
}

function fixtureSources(): Sources {
  return loadSources({
    consumerRoot: path.join(FIXTURES, "consumer"),
    packages: [],
    stockRoot: path.join(FIXTURES, "consumer-stock"),
  }).sources;
}

/** What `renderRules` plans for a written file: the body of an `AGENTS.md` region, any other file whole. */
function bodyOf(rel: string, text: string) {
  return rel.endsWith("AGENTS.md") ? `${regionBody(text, "<!--", "rules")}\n` : text;
}

it("matches the consumer fixture goldens byte for byte, path set included", () => {
  const goldens = new Map([...readGoldens()].filter(([rel]) => isRulesPath(rel)));
  const out = renderText(fixtureSources(), HOSTS);
  expect([...out.keys()].toSorted()).toStrictEqual([...goldens.keys()].toSorted());

  for (const [rel, text] of goldens) expect(out.get(rel), rel).toBe(bodyOf(rel, text));
});

it("renders this repo's committed AGENTS.md from its stock alone, in its repo:rules region", () => {
  const out = renderText(loadSources({ consumerRoot: null, packages: [], stockRoot: ROOT }).sources, HOSTS);
  expect(out.get("AGENTS.md")).toBe(bodyOf("AGENTS.md", fs.readFileSync(path.join(ROOT, "AGENTS.md"), "utf8")));
});

it("emits nothing with no host on", () => {
  expect(renderText(fixtureSources(), []).size).toBe(0);
});

it("folds stock pathless rules into AGENTS.md in source order and writes no file for them", () => {
  const stock = [BASE, stockRule("b.md", {}, "B."), stockRule("a.md", {}, "A.")];
  expect(Object.fromEntries(renderText(sourcesOf(stock), HOSTS))).toStrictEqual({
    "AGENTS.md": "Base body.\n\nB.\n\nA.\n",
  });
});

it("renders a repo pathless rule only when it overrides a stock one, where that was, and lists path rules", () => {
  const over = rule("overview.md", { overrides: "overview" }, "Mine instead.");
  const rules = [over, stockRule("b.md", {}, "B."), rule("mine.md", {}, "Mine."), SCOPED];
  expect(Object.fromEntries(renderText(sourcesOf(rules), ["codex"]))).toStrictEqual({
    "AGENTS.md": "Mine instead.\n\nB.\n\n## Rules by path\n- `src/** lib/**`: read `.repo/rules/testing.md`\n",
  });
});

it.each([[["**/*"]], [["*"]], [[]]])("treats paths %j as pathless", (paths) => {
  const out = renderText(sourcesOf([BASE, stockRule("p.md", { paths }, "P.")]), HOSTS);
  expect([...out.keys()]).toStrictEqual(["AGENTS.md"]);
  expect(out.get("AGENTS.md")).toBe("Base body.\n\nP.\n");
});

it("renders a path rule for claude with a paths list and nothing else", () => {
  const out = renderText(
    sourcesOf([BASE, rule("testing.md", { overrides: "x", paths: ["src/**", "lib/**"] }, "Test body.")]),
    ["claude"],
  );

  expect(out.get(".claude/rules/testing.md")).toBe("---\npaths:\n  - src/**\n  - lib/**\n---\nTest body.\n");
  expect([...out.keys()].toSorted()).toStrictEqual([".claude/rules/testing.md", "AGENTS.md"]);
});

it("renders a path rule for antigravity as a glob trigger", () => {
  const out = renderText(sourcesOf([BASE, SCOPED]), ["antigravity"]);
  expect(out.get(".agents/rules/testing.md")).toBe("---\ntrigger: glob\nglobs: src/**,lib/**\n---\nTest body.\n");
  expect([...out.keys()].toSorted()).toStrictEqual([".agents/rules/testing.md", "AGENTS.md"]);
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
    expect([...out.keys()]).toStrictEqual(["AGENTS.md"]);
    expect(out.get("AGENTS.md")).toBe(
      "Base body.\n\n## Rules by path\n- `src/** lib/**`: read `.repo/rules/testing.md`\n",
    );
  },
);

it("points a stock path rule into the installed package", () => {
  const stock = stockRule("style.md", { paths: ["**/*.ts"] }, "S.");
  const out = renderText(sourcesOf([BASE, stock]), ["codex"]);
  expect(out.get("AGENTS.md")).toContain("- `**/*.ts`: read `node_modules/@workerstack/repo/agents/rules/style.md`\n");
});

it("leaves the pointer list out when only claude or antigravity is on", () => {
  for (const host of ["claude", "antigravity"] as const)
    expect(renderText(sourcesOf([BASE, SCOPED]), [host]).get("AGENTS.md")).toBe("Base body.\n");
});

it("leaves the pointer list out when no rule has paths", () => {
  expect(renderText(sourcesOf([BASE]), ["codex"]).get("AGENTS.md")).toBe("Base body.\n");
});

it("writes no .grok/rules for any host set", () => {
  expect(
    [...renderText(sourcesOf([BASE, SCOPED]), HOSTS).keys()].filter((rel) => rel.startsWith(".grok/")),
  ).toStrictEqual([]);
});

it("lists every path rule once, in source order", () => {
  const out = renderText(sourcesOf([BASE, SCOPED, rule("b.md", { paths: ["b/**"] }, "B.")]), HOSTS);
  const list = (out.get("AGENTS.md") ?? "").split("## Rules by path\n")[1];
  expect(list).toBe("- `src/** lib/**`: read `.repo/rules/testing.md`\n- `b/**`: read `.repo/rules/b.md`\n");
});

it("is stripped from every host's subagent file", () => {
  const scout: Doc = {
    body: "Body.",
    data: { description: "Scout.", name: "scout", overrides: "scout" },
    file: "scout.md",
    origin: "repo",
    rel: ".repo/subagents/scout.md",
    scope: "",
  };

  const out = renderSubagents({ ...sourcesOf([]), subagents: [scout] }, HOSTS);
  expect(out.size).toBe(HOSTS.length);

  for (const [rel, text] of out) expect(text, rel).not.toContain("overrides");
});
