import { describe, expect, it } from "vitest";
import { inScope, rewrite } from "./codemod-repo-commands.ts";

describe("rewrite", () => {
  it("turns a script invocation by path into bun repo <cmd>, and leaves other scripts", () => {
    expect(rewrite("run `bun .rulesync/scripts/worktree.ts add x`", "a.md")).toBe("run `bun repo worktree add x`");
    expect(rewrite("node ./.rulesync/scripts/sync-global-settings.ts --apply", "a.md")).toBe("bun repo yolo");
    expect(rewrite("bun .rulesync/scripts/sync-global-settings.ts", "a.md")).toBe("bun repo yolo --dry-run");
    expect(rewrite("bun .rulesync/scripts/sync-global-settings.ts --check", "a.md")).toBe("bun repo yolo --check");
    expect(rewrite("bun .rulesync/scripts/purge-global-mcps.ts --apply", "a.md")).toBe("bun repo purge-mcps --apply");
    expect(rewrite("bun <root>/.rulesync/scripts/folder-map.ts <dir>", "a.md")).toBe("bun repo map <dir>");
    expect(rewrite("bun .rulesync/scripts/hooks-union.ts --check", "a.md")).toBe(
      "bun .rulesync/scripts/hooks-union.ts --check",
    );
  });

  it("turns bunx repo and a bare backticked repo <cmd> into bun repo, in markdown and in escaped message backticks", () => {
    expect(rewrite("`bunx repo setup` or `repo doctor`; `repo:doctor` stays", "a.md")).toBe(
      "`bun repo setup` or `bun repo doctor`; `repo:doctor` stays",
    );
    expect(rewrite("run \\`repo sync\\`", "a.ts")).toBe("run \\`bun repo sync\\`");
    expect(rewrite("warn(`repo map: ignoring`)", "a.ts")).toBe("warn(`repo map: ignoring`)");
    expect(rewrite("/** the `repo hook <name>` form */", "a.ts")).toBe("/** the `repo hook <name>` form */");
  });

  it("is idempotent", () => {
    const once = rewrite("`repo init`, bunx repo x, bun .rulesync/scripts/job.ts --job exec", "a.md");
    expect(rewrite(once, "a.md")).toBe(once);
  });
});

describe("inScope", () => {
  it("skips tests, fixtures, the changelog, package.json and generated host trees", () => {
    for (const f of [
      "AGENTS.md",
      ".agents/skills/x/SKILL.md",
      ".rulesync/subagents/a.md",
      ".grok/hooks/x.ts",
      "cli/main.ts",
    ])
      expect(inScope(f), f).toBe(true);
    for (const f of [
      "a.test.ts",
      "x/fixtures/a.md",
      "CHANGELOG.md",
      "package.json",
      ".claude/agents/a.md",
      ".codex/agents/a.toml",
      ".cursor/agents/a.md",
      ".grok/agents/a.md",
      ".agents/agents/a.md",
      "bun.lock",
    ]) {
      expect(inScope(f), f).toBe(false);
    }
  });
});
