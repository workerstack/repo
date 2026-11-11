import { expect, it, vi } from "vitest";

import { useTempDirs } from "./fixtures/temp-dirs.ts";
import { RENDER_TIMEOUT, STOCK_SKILL, consumer, context, find, linkTarget, render } from "./fixtures/trees-kit.ts";
import { renderTrees } from "./trees.ts";

useTempDirs();
vi.setConfig({ testTimeout: RENDER_TIMEOUT });

const OWN_ASK = "---\nname: ask\ndescription: mine\n---\n";
const NAMED_LIKE_STOCK =
  ".repo/skills/ask: a stock skill has this name; add `overrides: ask` to its SKILL.md or rename it";

/** The errors of a claude render over a consumer holding `files`. */
function failures(files: Record<string, string>): string[] {
  const result = renderTrees(context(consumer(files), ["claude"]));
  return result.ok ? [] : result.errors;
}

it("leaves out an optional pack unless agents.skills lists it", () => {
  const off = render(consumer(), ["claude", "codex"]);
  expect(find(off, ".agents/skills/listen")).toBeUndefined();
  expect(find(off, ".claude/skills/listen")).toBeUndefined();
  const on = render(consumer(), ["claude", "codex"], { skills: ["listen"] });
  expect(linkTarget(on, ".agents/skills/listen")).toBe(`${STOCK_SKILL}/listen`);
  expect(linkTarget(on, ".claude/skills/listen")).toBe("../../.agents/skills/listen");
});

it("lets a .repo/skills skill win over the stock one and add its own", () => {
  const root = consumer({
    ".repo/skills/ask/SKILL.md": "---\nname: ask\ndescription: mine\noverrides: ask\n---\n",
    ".repo/skills/deploy/SKILL.md": "---\nname: deploy\ndescription: ship\n---\n",
  });
  const claude = render(root, ["claude"]);
  expect(linkTarget(claude, ".claude/skills/ask")).toBe("../../.repo/skills/ask");
  expect(linkTarget(claude, ".claude/skills/deploy")).toBe("../../.repo/skills/deploy");
  const codex = render(root, ["codex"]);
  expect(linkTarget(codex, ".agents/skills/ask")).toBe("../../.repo/skills/ask");
  expect(linkTarget(codex, ".agents/skills/bro")).toBe(`${STOCK_SKILL}/bro`);
});

it("fails without overrides in its SKILL.md and names the fix", () => {
  expect(failures({ ".repo/skills/ask/SKILL.md": OWN_ASK })).toStrictEqual([NAMED_LIKE_STOCK]);
});

it("fails when SKILL.md has no frontmatter at all", () => {
  expect(failures({ ".repo/skills/ask/SKILL.md": "no frontmatter\n" })).toHaveLength(1);
});

it("links the own skill when SKILL.md says overrides with its name", () => {
  const root = consumer({ ".repo/skills/ask/SKILL.md": "---\nname: ask\ndescription: mine\noverrides: ask\n---\n" });
  expect(linkTarget(render(root, ["claude"]), ".claude/skills/ask")).toBe("../../.repo/skills/ask");
});

it("fails an overrides that names no stock skill", () => {
  expect(
    failures({ ".repo/skills/mine/SKILL.md": "---\nname: mine\ndescription: mine\noverrides: nope\n---\n" }),
  ).toStrictEqual(['.repo/skills/mine/SKILL.md: overrides "nope" but no stock skill has that name']);
});

it("does not ask a new skill for anything", () => {
  expect(failures({ ".repo/skills/deploy/SKILL.md": "---\nname: deploy\ndescription: ship\n---\n" })).toStrictEqual([]);
});

it("reports skill and rule problems together", () => {
  expect(failures({ ".repo/rules/a.md": "no fence\n", ".repo/skills/ask/SKILL.md": OWN_ASK })).toStrictEqual([
    NAMED_LIKE_STOCK,
    ".repo/rules/a.md: missing frontmatter (start the file with a --- block)",
  ]);
});
