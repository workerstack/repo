import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { expect, it } from "vitest";

import type { Workflow } from "../../workflow.ts";
import { rule } from "../__fixtures__/rules-kit.ts";
import { regionBody } from "../region.ts";
import { loadSources } from "./load-sources.ts";
import { renderRules } from "./rules.ts";
import type { Doc } from "./sources.types.ts";
import { WORKFLOW_ANCHOR, WORKFLOW_PARAGRAPHS } from "./workflow-paragraph.constants.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const STOCK = loadSources({ consumerRoot: null, packages: [], stockRoot: ROOT }).sources.rules;
const WEB = "packages/web";

/** The root `AGENTS.md` that `rules` render to under `workflow`, for codex alone. */
function agents(rules: readonly Doc[], workflow: Workflow): string {
  return renderRules(rules, { effort: "deep", hosts: ["codex"], scope: "", workflow }).get("AGENTS.md")?.text ?? "";
}

function anchoredLines(text: string): string[] {
  return text.split(/\r?\n/).filter((line) => line.startsWith(WORKFLOW_ANCHOR));
}

it("finds the anchor exactly once in the real stock overview", () => {
  const overview = STOCK.find((doc) => doc.rel === "agents/rules/overview.md");
  expect(anchoredLines(overview?.body ?? "")).toHaveLength(1);
  expect(anchoredLines(agents(STOCK, "worktree"))).toHaveLength(1);
});

it.each(["pull-request", "main"] as const)("renders the %s paragraph in place of the stock one", (workflow) => {
  const worktree = agents(STOCK, "worktree");
  const [stock] = anchoredLines(worktree);
  const out = agents(STOCK, workflow);
  expect(anchoredLines(out)).toStrictEqual([]);
  expect(out.split("\n")).toContain(WORKFLOW_PARAGRAPHS[workflow]);
  expect(out).toBe(worktree.replace(stock ?? "", WORKFLOW_PARAGRAPHS[workflow]));
});

it("renders the worktree paragraph as this repo's committed AGENTS.md has it, byte for byte", () => {
  const committed = fs.readFileSync(path.join(ROOT, "AGENTS.md"), "utf8");
  const out = renderRules(STOCK, { effort: "deep", hosts: ["claude"], scope: "", workflow: "worktree" });
  expect(out.get("AGENTS.md")?.text).toBe(`${regionBody(committed, "<!--", "rules")}\n`);
});

it("keeps an override that drops the anchor as written", () => {
  const over = rule("overview.md", { overrides: "overview" }, "Mine instead.");
  expect(agents([over], "main")).toMatch(/^Mine instead\.\n\n/);
});

it("gives an override that keeps the anchor the mode paragraph, with CRLF lines read too", () => {
  const over = rule("overview.md", { overrides: "overview" }, `Intro.\r\n${WORKFLOW_ANCHOR} Mine.\r\nOutro.`);
  const out = agents([over], "pull-request");
  expect(out.startsWith(`Intro.\n${WORKFLOW_PARAGRAPHS["pull-request"]}\nOutro.\n\n`)).toBe(true);
});

it("never changes a package scope", () => {
  const body = `${WORKFLOW_ANCHOR} Package text.`;
  const pkg: Doc = { ...rule("pkg.md", { overrides: "x" }, body), rel: `${WEB}/.repo/rules/pkg.md`, scope: WEB };
  const out = renderRules([pkg], { effort: "deep", hosts: ["claude"], scope: WEB, workflow: "main" });
  expect(out.get(`${WEB}/AGENTS.md`)?.text).toContain(`\n\n${body}\n`);
  expect(out.get(`.claude/rules/${WEB}/pkg.md`)?.text).toContain(`\n${body}\n`);
});
