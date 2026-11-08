import { describe, expect, it } from "vitest";
import { inScope, rewrite } from "./codemod-reference-paths.ts";

const P = "node_modules/@workerstack/repo/references/";

describe("rewrite", () => {
  it("points a reference file and the bare directory at the package", () => {
    expect(rewrite("Format: `.rulesync/reference/plan-format.md`.", "a.md")).toBe(`Format: \`${P}plan-format.md\`.`);
    expect(rewrite("docs in `.rulesync/reference/`", "a.md")).toBe(`docs in \`${P}\``);
    expect(rewrite("docs in `.rulesync/reference`", "a.md")).toBe(`docs in \`${P}\``);
  });

  it("sends the removed law, skills-map and refs-map files to INDEX.md", () => {
    for (const f of ["law", "skills-map", "refs-map"]) expect(rewrite(`see .rulesync/reference/${f}.md`, "a.md")).toBe(`see ${P}INDEX.md`);
  });

  it("makes a ../ repo path root-relative inside references/ only", () => {
    expect(rewrite("`../../.rulesync/scripts/x.ts` `../.rulesync/y.ts` `../../.grok/hooks/z.json`", "references/hooks.md")).toBe("`.rulesync/scripts/x.ts` `.rulesync/y.ts` `.grok/hooks/z.json`");
    expect(rewrite("`../../.rulesync/scripts/x.ts`", "docs/a.md")).toBe("`../../.rulesync/scripts/x.ts`");
    expect(rewrite("`../../.agents/skills/x`", "references/map.md")).toBe("`../../.agents/skills/x`");
  });

  it("is idempotent", () => {
    const once = rewrite("`.rulesync/reference/law.md`, `.rulesync/reference/cascade.md`, `.rulesync/reference/`", "references/a.md");
    expect(rewrite(once, "references/a.md")).toBe(once);
  });
});

describe("inScope", () => {
  it("takes markdown outside tests, fixtures, the changelog, lessons, AGENTS.md and host trees", () => {
    for (const f of [".rulesync/rules/overview.md", ".agents/skills/x/SKILL.md", "references/map.md", ".rulesync/subagents/a.md"]) expect(inScope(f), f).toBe(true);
    for (const f of ["x/fixtures/a.md", "CHANGELOG.md", "AGENTS.md", ".repo/lessons/a.md", ".claude/agents/a.md", ".grok/roles/a.md", ".agents/agents/a.md", "cli/init.ts"]) {
      expect(inScope(f), f).toBe(false);
    }
  });
});
