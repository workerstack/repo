import { describe, expect, it, vi } from "vitest";
import { HOSTS, type Host } from "../config.ts";
import { renderTrees } from "./trees.ts";
import { RENDER_TIMEOUT, consumer, context, render, stagesIn, text } from "./fixtures/trees-kit.ts";
import { put, tempDir, useTempDirs } from "./fixtures/temp-dirs.ts";

useTempDirs();
vi.setConfig({ testTimeout: RENDER_TIMEOUT });

const HOUSE = { ".repo/rules/house.md": '---\ndescription: house\npaths: ["**/*"]\n---\nAlways greet the cat.\n' };

it.each<{ hosts: readonly Host[] }>([{ hosts: ["claude"] }, { hosts: HOSTS }])(
  "renders a pathless .repo/rules rule into no file with $hosts on",
  ({ hosts }) => {
    const outputs = render(consumer(HOUSE), hosts);
    expect(outputs.filter((o) => o.kind === "file" && o.content.includes("Always greet the cat."))).toStrictEqual([]);
  },
);

describe("a rule with paths", () => {
  const rule = "---\ndescription: Team rule\npaths:\n  - src/**\n---\nTEAM RULE TEXT\n";
  const reach = (hosts: readonly Host[]) => {
    const outputs = render(consumer({ ".repo/rules/team.md": rule }), hosts);
    return outputs.filter((o) => o.kind === "file" && o.content.includes("TEAM RULE TEXT")).map((o) => o.path);
  };

  it("lands in .claude/rules for claude and is only pointed to from AGENTS.md for codex", () => {
    expect(reach(["claude"])).toStrictEqual([".claude/rules/team.md"]);
    expect(reach(["codex"])).toStrictEqual([]);
    const agents = text(render(consumer({ ".repo/rules/team.md": rule }), ["codex"]), "AGENTS.md");
    expect(agents).toContain("- `src/**`: read `.repo/rules/team.md`");
  });

  it("reports every source problem in one failed render", () => {
    const root = consumer({ ".repo/rules/a.md": "no fence\n", ".repo/rules/b.md": "---\npaths: []\n---\nB\n" });
    const result = renderTrees(context(root, ["claude"]));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toStrictEqual([
        ".repo/rules/a.md: missing frontmatter (start the file with a --- block)",
        ".repo/rules/b.md: invalid frontmatter: description is required",
      ]);
    }
  });
});

it("fails on a tasks.json it cannot parse", () => {
  const root = consumer({ ".vscode/tasks.json": "{" });
  const result = renderTrees(context(root, ["claude"]));
  expect(result).toStrictEqual({ ok: false, errors: [expect.stringContaining(".vscode/tasks.json")] });
  expect(stagesIn(root)).toStrictEqual([]);
});

it("names a .repo rule without frontmatter and removes the stage", () => {
  const root = consumer({ ".repo/rules/nofm.md": "no frontmatter here\n" });
  expect(renderTrees(context(root, ["codex"]))).toStrictEqual({
    ok: false,
    errors: [".repo/rules/nofm.md: missing frontmatter (start the file with a --- block)"],
  });
  expect(stagesIn(root)).toStrictEqual([]);
});

it("reports a missing stock package", () => {
  const bare = tempDir("workerstack-trees-");
  put(bare, "workerstack.config.ts", "export default {}\n");
  expect(renderTrees(context(bare, ["claude"]))).toStrictEqual({
    ok: false,
    errors: [expect.stringContaining("bun install")],
  });
});
