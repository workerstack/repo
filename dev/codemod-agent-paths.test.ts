import { describe, expect, it } from "vitest";
import { inScope, rewrite } from "./codemod-agent-paths.ts";

describe("rewrite", () => {
  it("moves the lessons dir to .repo/lessons", () => {
    expect(rewrite("read `.rulesync/lessons/INDEX.md` and `.rulesync/lessons`")).toBe(
      "read `.repo/lessons/INDEX.md` and `.repo/lessons`",
    );
  });

  it("sends every generate spelling to bun repo sync", () => {
    expect(rewrite("run `bun run rulesync:generate`")).toBe("run `bun repo sync`");
    expect(rewrite("run `bun run repo:rulesync:generate`")).toBe("run `bun repo sync`");
    expect(rewrite("run `bun repo generate`")).toBe("run `bun repo sync`");
    expect(rewrite("the `repo:rulesync:generate` script and `rulesync:generate`")).toBe(
      "the `repo sync` script and `repo sync`",
    );
    expect(rewrite("`repo generate` writes")).toBe("`repo sync` writes");
  });

  it("sends the check spellings to bun repo sync --check", () => {
    expect(rewrite("`bun run rulesync:check`")).toBe("`bun repo sync --check`");
    expect(rewrite("`bun run repo:rulesync:check`")).toBe("`bun repo sync --check`");
    expect(rewrite("the `repo:rulesync:check` script")).toBe("the `repo sync --check` script");
  });

  it("sends repo upgrade to repo sync", () => {
    expect(rewrite("run `bun repo upgrade`")).toBe("run `bun repo sync`");
  });

  it("leaves other text alone", () => {
    const text = "run `bun repo sync`, `bun run rulesync:doctor`, .repo/lessons and upgrade the dependency";
    expect(rewrite(text)).toBe(text);
  });

  it("is idempotent", () => {
    const once = rewrite(
      "`.rulesync/lessons/` `bun run rulesync:generate` `bun run rulesync:check` `repo generate` `repo upgrade`",
    );
    expect(rewrite(once)).toBe(once);
  });
});

describe("inScope", () => {
  it("takes markdown outside tests, fixtures, the changelog, lessons, AGENTS.md and host trees", () => {
    for (const f of [
      ".rulesync/rules/overview.md",
      ".agents/skills/x/SKILL.md",
      "references/map.md",
      ".rulesync/subagents/a.md",
    ])
      expect(inScope(f), f).toBe(true);
    for (const f of [
      "x/fixtures/a.md",
      "CHANGELOG.md",
      "AGENTS.md",
      ".repo/lessons/a.md",
      ".claude/agents/a.md",
      ".grok/roles/a.md",
      ".agents/agents/a.md",
      "cli/init.ts",
    ]) {
      expect(inScope(f), f).toBe(false);
    }
  });
});
