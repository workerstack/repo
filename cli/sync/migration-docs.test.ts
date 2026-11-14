import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { REMOVAL, clash, mini, notes, planOf } from "./__fixtures__/mini-install.ts";
import { useTempDirs } from "./__fixtures__/temp-dirs.ts";
import { conflictLines } from "./migrate.ts";

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
    ".rulesync/rules/overview.md":
      "---\nroot: true\n---\n# Mine\n\n## Stock\n\nedited body\n\n## Ours\n\nlocal text\n\n## Also\n\nmore\n",
    ".rulesync/rules/plain.md": "---\nroot: false\n---\n## Extra\n\nhere\n",
    ".rulesync/rules/team.md": "own\n",
  });

  expect(planOf(m).slice(0, 3)).toStrictEqual([
    {
      content: `${CARRIED}# Overview\n\n## Ours\n\nlocal text\n\n## Also\n\nmore\n`,
      kind: "write",
      note: 'moved your sections "Ours", "Also" of .rulesync/rules/overview.md to .repo/rules/overview-local.md',
      path: ".repo/rules/overview-local.md",
    },
    {
      content: `${CARRIED}## Extra\n\nhere\n`,
      kind: "write",
      note: 'moved your sections "Extra" of .rulesync/rules/plain.md to .repo/rules/plain-local.md',
      path: ".repo/rules/plain-local.md",
    },
    {
      from: ".rulesync/rules/team.md",
      kind: "move",
      note: "moved .rulesync/rules/team.md to .repo/rules/team.md",
      to: ".repo/rules/team.md",
    },
  ]);
});

it("leaves a stock rule with no extra sections to the removal, and a -local sibling already written alone", () => {
  const m = mini({
    ".repo/rules/plain-local.md": `${CARRIED}## Extra\n\nhere\n`,
    ".rulesync/rules/overview.md": "---\nroot: true\n---\n# Overview\n\n## Stock\n\nbody\n",
    ".rulesync/rules/plain.md": "---\nroot: false\n---\n## Extra\n\nhere\n",
  });

  expect(planOf(m)).toStrictEqual([REMOVAL]);
});

it("stops on a -local sibling that holds other text", () => {
  const m = mini({
    ".repo/rules/plain-local.md": "other\n",
    ".rulesync/rules/plain.md": "---\nroot: false\n---\n## Extra\n\nhere\n",
  });

  expect(conflictLines(planOf(m))).toStrictEqual([clash(".rulesync/rules/plain.md", ".repo/rules/plain-local.md")]);
});

it("moves an edited stock subagent whole as an override, and leaves an identical one to the removal", () => {
  const m = mini({
    ".rulesync/subagents/orchestrator.md": "own\n",
    ".rulesync/subagents/scout.md": "edited scout\n",
  });

  expect(notes(planOf(m))).toStrictEqual([
    "moved .rulesync/subagents/orchestrator.md to .repo/subagents/orchestrator.md",
    "moved your edited .rulesync/subagents/scout.md to .repo/subagents/scout.md (it now replaces the stock subagent)",
  ]);
  expect(planOf(mini({ ".rulesync/subagents/scout.md": "scout\r\n" }))).toStrictEqual([REMOVAL]);
});

const SKILL_COPIES = {
  ".agents/skills/README.md": "not a skill\n",
  ".agents/skills/ask/SKILL.md": "edited\n",
  ".agents/skills/bro/SKILL.md": "bro\n",
  ".agents/skills/deploy/SKILL.md": "deploy\n",
};

const ASK_MARK = {
  content: "---\noverrides: ask\n---\nedited\n",
  note: "marked .repo/skills/ask/SKILL.md with overrides: ask (it replaces the stock skill)",
  path: ".agents/skills/ask/SKILL.md",
};

it("moves an edited stock skill whole, a skill the stock lacks, and removes the identical copies", () => {
  const m = mini(SKILL_COPIES, { stock: { "agents/skills/bro/SKILL.md": "bro\n" } });
  expect(planOf(m)).toStrictEqual([
    {
      from: ".agents/skills/ask",
      kind: "move",
      mark: ASK_MARK,
      note: "moved your edited .agents/skills/ask to .repo/skills/ask (it now replaces the stock skill)",
      to: ".repo/skills/ask",
    },
    {
      from: ".agents/skills/deploy",
      kind: "move",
      note: "moved .agents/skills/deploy to .repo/skills/deploy",
      to: ".repo/skills/deploy",
    },
    { kind: "remove", paths: [".agents/skills/bro", ".rulesync"] },
  ]);
});

it("treats a skill whose file list differs as edited", () => {
  const m = mini({ ".agents/skills/ask/SKILL.md": "ask\n", ".agents/skills/ask/extra.md": "extra\n" });
  expect(planOf(m)[0]).toMatchObject({ from: ".agents/skills/ask", kind: "move" });
});

const OLD_COPY = { ".agents/skills/write-plan/SKILL.md": "---\nname: write-plan\n---\nedited; then /implement-plan\n" };
const OLD_FROM = ".agents/skills/write-plan";
const NEW_TO = ".repo/skills/write-plan-deep";

describe("planSkills of an old stock skill name", () => {
  it("moves an edited copy to the new name as an override, its SKILL.md renamed", () => {
    const m = mini(OLD_COPY, { stock: { "agents/skills/write-plan-deep/SKILL.md": "stock\n" } });
    expect(planOf(m)[0]).toStrictEqual({
      from: OLD_FROM,
      kind: "move",
      mark: {
        content: "---\noverrides: write-plan-deep\nname: write-plan-deep\n---\nedited; then /implement-plan-deep\n",
        note: `marked ${NEW_TO}/SKILL.md with overrides: write-plan-deep (it replaces the stock skill)`,
        path: `${OLD_FROM}/SKILL.md`,
      },
      note: `moved your edited ${OLD_FROM} to ${NEW_TO} (it now replaces the stock skill)`,
      to: NEW_TO,
    });
  });

  it("moves a copy the stock lacks to the new name with its SKILL.md renamed and no override", () => {
    expect(planOf(mini(OLD_COPY))[0]).toStrictEqual({
      from: OLD_FROM,
      kind: "move",
      mark: {
        content: "---\nname: write-plan-deep\n---\nedited; then /implement-plan-deep\n",
        note: `renamed the old skill names in ${NEW_TO}/SKILL.md`,
        path: `${OLD_FROM}/SKILL.md`,
      },
      note: `moved ${OLD_FROM} to ${NEW_TO}`,
      to: NEW_TO,
    });
  });
});

it("moves a copy of an old stock skill name unmarked when its SKILL.md names no old skill or is not there", () => {
  const unmarked = { from: OLD_FROM, kind: "move", note: `moved ${OLD_FROM} to ${NEW_TO}`, to: NEW_TO };
  expect(planOf(mini({ [`${OLD_FROM}/SKILL.md`]: "mine\n" }))[0]).toStrictEqual(unmarked);
  expect(planOf(mini({ [`${OLD_FROM}/notes.md`]: "mine\n" }))[0]).toStrictEqual(unmarked);
});
