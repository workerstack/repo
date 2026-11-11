import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { conflictLines } from "./migrate.ts";
import { REMOVAL, clash, mini, notes, planOf } from "./fixtures/mini-install.ts";
import { useTempDirs } from "./fixtures/temp-dirs.ts";

useTempDirs();

const CARRIED = "---\ndescription: Carried over from your earlier setup\n---\n";

describe("planMigration without a usable stock", () => {
  it("plans nothing while the stock package is not installed", () => {
    const m = mini({});
    fs.rmSync(path.join(m.stock, "package.json"));
    expect(planOf(m)).toStrictEqual([]);
  });

  it("plans only the removal for an install that holds nothing of its own", () => {
    expect(planOf(mini({}))).toStrictEqual([REMOVAL]);
  });
});

it("moves a rule the stock lacks, and keeps stock rules live by writing extra sections to a -local sibling", () => {
  const m = mini({
    ".rulesync/rules/team.md": "own\n",
    ".rulesync/rules/overview.md":
      "---\nroot: true\n---\n# Mine\n\n## Stock\n\nedited body\n\n## Ours\n\nlocal text\n\n## Also\n\nmore\n",
    ".rulesync/rules/plain.md": "---\nroot: false\n---\n## Extra\n\nhere\n",
  });
  expect(planOf(m).slice(0, 3)).toStrictEqual([
    {
      kind: "write",
      path: ".repo/rules/overview-local.md",
      content: `${CARRIED}# Overview\n\n## Ours\n\nlocal text\n\n## Also\n\nmore\n`,
      note: 'moved your sections "Ours", "Also" of .rulesync/rules/overview.md to .repo/rules/overview-local.md',
    },
    {
      kind: "write",
      path: ".repo/rules/plain-local.md",
      content: `${CARRIED}## Extra\n\nhere\n`,
      note: 'moved your sections "Extra" of .rulesync/rules/plain.md to .repo/rules/plain-local.md',
    },
    {
      kind: "move",
      from: ".rulesync/rules/team.md",
      to: ".repo/rules/team.md",
      note: "moved .rulesync/rules/team.md to .repo/rules/team.md",
    },
  ]);
});

it("leaves a stock rule with no extra sections to the removal, and a -local sibling already written alone", () => {
  const m = mini({
    ".rulesync/rules/overview.md": "---\nroot: true\n---\n# Overview\n\n## Stock\n\nbody\n",
    ".rulesync/rules/plain.md": "---\nroot: false\n---\n## Extra\n\nhere\n",
    ".repo/rules/plain-local.md": `${CARRIED}## Extra\n\nhere\n`,
  });
  expect(planOf(m)).toStrictEqual([REMOVAL]);
});

it("stops on a -local sibling that holds other text", () => {
  const m = mini({
    ".rulesync/rules/plain.md": "---\nroot: false\n---\n## Extra\n\nhere\n",
    ".repo/rules/plain-local.md": "other\n",
  });
  expect(conflictLines(planOf(m))).toStrictEqual([clash(".rulesync/rules/plain.md", ".repo/rules/plain-local.md")]);
});

it("moves an edited stock subagent whole as an override, and leaves an identical one to the removal", () => {
  const m = mini({
    ".rulesync/subagents/scout.md": "edited scout\n",
    ".rulesync/subagents/orchestrator.md": "own\n",
  });
  expect(notes(planOf(m))).toStrictEqual([
    "moved .rulesync/subagents/orchestrator.md to .repo/subagents/orchestrator.md",
    "moved your edited .rulesync/subagents/scout.md to .repo/subagents/scout.md (it now replaces the stock subagent)",
  ]);
  expect(planOf(mini({ ".rulesync/subagents/scout.md": "scout\r\n" }))).toStrictEqual([REMOVAL]);
});

const SKILL_COPIES = {
  ".agents/skills/ask/SKILL.md": "edited\n",
  ".agents/skills/deploy/SKILL.md": "deploy\n",
  ".agents/skills/bro/SKILL.md": "bro\n",
  ".agents/skills/README.md": "not a skill\n",
};
const ASK_MARK = {
  path: ".agents/skills/ask/SKILL.md",
  content: "---\noverrides: ask\n---\nedited\n",
  note: "marked .repo/skills/ask/SKILL.md with overrides: ask (it replaces the stock skill)",
};

it("moves an edited stock skill whole, a skill the stock lacks, and removes the identical copies", () => {
  const m = mini(SKILL_COPIES, { stock: { "agents/skills/bro/SKILL.md": "bro\n" } });
  expect(planOf(m)).toStrictEqual([
    {
      kind: "move",
      from: ".agents/skills/ask",
      to: ".repo/skills/ask",
      note: "moved your edited .agents/skills/ask to .repo/skills/ask (it now replaces the stock skill)",
      mark: ASK_MARK,
    },
    {
      kind: "move",
      from: ".agents/skills/deploy",
      to: ".repo/skills/deploy",
      note: "moved .agents/skills/deploy to .repo/skills/deploy",
    },
    { kind: "remove", paths: [".agents/skills/bro", ".rulesync"] },
  ]);
});

it("treats a skill whose file list differs as edited", () => {
  const m = mini({ ".agents/skills/ask/SKILL.md": "ask\n", ".agents/skills/ask/extra.md": "extra\n" });
  expect(planOf(m)[0]).toMatchObject({ kind: "move", from: ".agents/skills/ask" });
});
