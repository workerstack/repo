import { afterAll, expect, it } from "vitest";
import type { MigrateDeps } from "./migrate.ts";
import { hashText } from "./stock-history.ts";
import { CONFIG, LINES, copied, copiedPlan, dropFixture } from "./fixtures/copied-install.ts";
import { mini, notes, planOf } from "./fixtures/mini-install.ts";
import { useTempDirs } from "./fixtures/temp-dirs.ts";

useTempDirs();
afterAll(dropFixture);

const OLD_RULE = "---\nroot: false\n---\n# Overview\n\n## Retired section\n\nold stock text\n";
const OLD_HOOKS = '{ "old": true }\n';
const hist = (entries: Record<string, string[]>): MigrateDeps => ({
  history: Object.fromEntries(Object.entries(entries).map(([rel, texts]) => [rel, texts.map(hashText)])),
});
/** Each copied file as one older stock version had it, the consumer's line endings aside. */
const OLD_COPIES: Record<string, string> = {
  ".rulesync/rules/overview.md": OLD_RULE,
  ".rulesync/rules/retired.md": "a rule stock dropped\n",
  ".rulesync/subagents/gone.md": "a subagent stock dropped\n",
  ".rulesync/hooks.jsonc": OLD_HOOKS,
  ".rulesync/global-settings/old.toml": "x = 1\n",
  ".rulesync/reference/skills-guide.md": "# Guide\n",
  ".agents/skills/ask/SKILL.md": "old ask\n",
  ".agents/skills/gone/SKILL.md": "old gone\n",
  ".claude/settings.json": '{ "env": { "OLD": "1" } }\n',
  "AGENTS.md": "old whole agents file\n",
};

it("removes a copy equal to an older stock version instead of moving it, whatever its line endings", () => {
  const m = mini({
    ...OLD_COPIES,
    ".rulesync/rules/retired.md": "a rule stock dropped\r\n",
    ".rulesync/reference/hooks.md": "# Hooks\n\n## Retired\n\nold\n",
  });
  const history = Object.fromEntries(Object.entries(OLD_COPIES).map(([rel, text]) => [rel, [text]]));
  const deps = hist({ ...history, "references/hooks.md": ["# Hooks\n\n## Retired\n\nold\n"] });
  expect(planOf(m, CONFIG, deps)).toEqual([
    { kind: "remove", paths: [".agents/skills/ask", ".agents/skills/gone", ".rulesync"] },
  ]);
});

it("still moves an edit of an older version, and a file the history does not know", () => {
  const m = mini({
    ".rulesync/rules/overview.md": `${OLD_RULE}\n## Ours\n\nmine\n`,
    ".rulesync/hooks.jsonc": '{ "old": true, "mine": 1 }\n',
    ".agents/skills/ask/SKILL.md": "old ask\n",
    ".agents/skills/ask/extra.md": "my addition\n",
  });
  const deps = hist({
    ".rulesync/rules/overview.md": [OLD_RULE],
    ".rulesync/hooks.jsonc": [OLD_HOOKS],
    ".agents/skills/ask/SKILL.md": ["old ask\n"],
  });
  expect(notes(planOf(m, CONFIG, deps))).toEqual([
    'moved your sections "Retired section", "Ours" of .rulesync/rules/overview.md to .repo/rules/overview-local.md',
    "moved your edited .agents/skills/ask to .repo/skills/ask (it now replaces the stock skill)",
    "moved your .rulesync/hooks.jsonc to .repo/hooks.jsonc (it now replaces the stock hooks)",
  ]);
});

it("uses the shipped table: the recorded install's stock copies are all unedited", async () => {
  const moved = notes(await copiedPlan(copied()));
  expect(moved).toEqual(LINES.map((line) => line.replace("repo sync: ", "")));
});
