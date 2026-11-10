import { expect, it, vi } from "vitest";
import { HOSTS, type Host } from "../config.ts";
import { renderTrees } from "./trees.ts";
import { RENDER_TIMEOUT, consumer, context, find, linkTarget, render, text } from "./fixtures/trees-kit.ts";
import { useTempDirs } from "./fixtures/temp-dirs.ts";

useTempDirs();
vi.setConfig({ testTimeout: RENDER_TIMEOUT });

const pkgRule = "---\ndescription: Web rule\n---\nWEB PACKAGE RULE\n";
const skill = "---\nname: deploy\ndescription: Ships the package.\n---\nDeploy.\n";
const apiRule = "---\ndescription: Api\npaths:\n  - src/api/**\n---\nAPI RULE\n";
const START = "Start at references/INDEX.md in this package.\n";
const web = () =>
  consumer({
    "packages/web/.repo/rules/web.md": pkgRule,
    "packages/web/.repo/rules/api.md": apiRule,
    "packages/web/.repo/skills/deploy/SKILL.md": skill,
    "packages/api/package.json": "{}",
    ".repo/rules/house.md": "---\ndescription: h\n---\nHOUSE\n",
  });
const renderWeb = (hosts: readonly Host[]) => render(web(), hosts, { packages: ["packages/web", "packages/api"] });

it("writes each package's AGENTS.md and CLAUDE.md, untracked, and keeps its rules out of the root AGENTS.md", () => {
  const outputs = renderWeb(HOSTS);
  expect(text(outputs, "AGENTS.md")).toContain("HOUSE");
  expect(text(outputs, "AGENTS.md")).not.toMatch(/WEB PACKAGE RULE|API RULE/);
  expect(text(outputs, "packages/web/AGENTS.md")).toBe(
    `${START}\nWEB PACKAGE RULE\n\n## Rules by path\n- \`packages/web/src/api/**\`: read \`packages/web/.repo/rules/api.md\`\n`,
  );
  expect(text(outputs, "packages/web/CLAUDE.md")).toBe(START);
  expect(text(outputs, "packages/api/AGENTS.md")).toBe(START);
  for (const rel of ["packages/web/AGENTS.md", "packages/web/CLAUDE.md"])
    expect(find(outputs, rel)).toMatchObject({ tracked: false, managed: "whole" });
});

it("renders package rules under the host rule dirs and nests the package's skills per host", () => {
  const outputs = renderWeb(HOSTS);
  expect(text(outputs, ".claude/rules/packages/web/web.md")).toBe(
    "---\npaths:\n  - packages/web/**\n---\nWEB PACKAGE RULE\n",
  );
  expect(text(outputs, ".agents/rules/packages/web/api.md")).toContain("globs: packages/web/src/api/**");
  expect(linkTarget(outputs, "packages/web/.claude/skills/deploy")).toBe("../../.repo/skills/deploy");
  expect(linkTarget(outputs, "packages/web/.agents/skills/deploy")).toBe("../../.repo/skills/deploy");
  expect(find(outputs, "packages/web/.claude/skills/deploy")).toMatchObject({ tracked: false, managed: "whole" });
  expect(outputs.filter((o) => o.path.startsWith("packages/api/") && o.kind === "link")).toEqual([]);
});

it("links package skills only for the hosts that read them", () => {
  const claude = renderWeb(["claude"]);
  expect(find(claude, "packages/web/.claude/skills/deploy")).toBeDefined();
  expect(find(claude, "packages/web/.agents/skills/deploy")).toBeUndefined();
  expect(find(claude, "packages/web/CLAUDE.md")).toBeDefined();
  const codex = renderWeb(["codex"]);
  expect(find(codex, "packages/web/.agents/skills/deploy")).toBeDefined();
  expect(find(codex, "packages/web/.claude/skills/deploy")).toBeUndefined();
  expect(find(codex, "packages/web/CLAUDE.md")).toBeUndefined();
  expect(find(codex, ".claude/rules/packages/web/web.md")).toBeUndefined();
});

it("refuses a root rule and a package rule that render one file, naming both sources", () => {
  const root = consumer({
    ".repo/rules/packages/web/web.md": "---\ndescription: r\npaths:\n  - x/**\n---\nROOT\n",
    "packages/web/.repo/rules/web.md": pkgRule,
    "x/a.ts": "",
  });
  expect(renderTrees(context(root, ["claude"], { packages: ["packages/web"] }))).toEqual({
    ok: false,
    errors: [
      ".claude/rules/packages/web/web.md: planned by .repo/rules/packages/web/web.md and packages/web/.repo/rules/web.md; rename one",
    ],
  });
});

it("refuses a package .repo with a directory sync does not read there", () => {
  const root = consumer({ "packages/web/.repo/lessons/a.md": "x\n" });
  const result = renderTrees(context(root, ["claude"], { packages: ["packages/web"] }));
  expect(result).toEqual({
    ok: false,
    errors: [
      "packages/web/.repo/lessons/: a package .repo holds only rules/ and skills/; lessons live in the root .repo",
    ],
  });
});
