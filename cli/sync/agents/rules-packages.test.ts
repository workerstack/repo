import { expect, it } from "vitest";

import { HOSTS } from "../../config.ts";
import { BASE, renderText, SCOPED, sourcesOf } from "../__fixtures__/rules-kit.ts";
import { renderRules } from "./rules.ts";
import type { Doc, Sources } from "./sources.types.ts";

const WEB = "packages/web";

function pkgRule(file: string, data: Doc["data"], body: string): Doc {
  return {
    body,
    data: { description: "d", ...data },
    file,
    origin: "repo",
    rel: `${WEB}/.repo/rules/${file}`,
    scope: WEB,
  };
}

const POINTER = "Start at references/INDEX.md in this package.";
const COMPONENTS = pkgRule("components.md", {}, "Components live in src/components and use the ui kit.");
const API = pkgRule("api.md", { paths: ["src/api/**"] }, "Api body.");
const sources = sourcesOf([BASE, SCOPED, COMPONENTS, API]);

it("writes the package AGENTS.md: the pointer line, then a pointer per path rule, none of its pathless rules", () => {
  const out = renderText(sources, ["codex"], WEB, "fast");
  expect(out.get(`${WEB}/AGENTS.md`)).toBe(
    `${POINTER}\n\n## Rules by path\n- \`packages/web/src/api/**\`: read \`packages/web/.repo/rules/api.md\`\n`,
  );
  expect([...out.keys()]).toStrictEqual([`${WEB}/AGENTS.md`]);
});

it(
  "leaves the pointer list out when no host that needs it is on, writes no CLAUDE.md, " +
    "and the root AGENTS.md has no package rule",
  () => {
    expect(renderText(sources, ["claude"], WEB).get(`${WEB}/AGENTS.md`)).toBe(`${POINTER}\n`);
    expect([...renderText(sources, HOSTS, WEB).keys()].filter((rel) => rel.includes("CLAUDE"))).toStrictEqual([]);
    const root = renderText(sources, HOSTS, "");

    for (const [rel, text] of root) expect(`${rel}\n${text}`, rel).not.toMatch(/Components live|packages\/web/);
  },
);

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
  const rendered = renderRules(sources.rules, { effort: "deep", hosts: ["claude"], scope: WEB, workflow: "worktree" });
  expect(rendered.get(".claude/rules/packages/web/api.md")?.source).toBe(`${WEB}/.repo/rules/api.md`);
  expect(renderText(sources, ["claude"], "packages/empty").get("packages/empty/AGENTS.md")).toBe(`${POINTER}\n`);
});

it("emits nothing with no host on", () => {
  expect(renderRules(sources.rules, { effort: "deep", hosts: [], scope: WEB, workflow: "worktree" }).size).toBe(0);
});
