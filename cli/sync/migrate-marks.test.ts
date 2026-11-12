import { expect, it } from "vitest";

import { linkStock, read, sync, write } from "./__fixtures__/copied-install.ts";
import { mini, planOf } from "./__fixtures__/mini-install.ts";
import { tempDir, useTempDirs } from "./__fixtures__/temp-dirs.ts";
import { applyMigration } from "./apply-migration.ts";

useTempDirs();

const STOCK_PLAIN = { stock: { "agents/rules/plain.md": "---\nroot: false\n---\nstock plain\n" } };

/** Edited copies of a stock rule, subagent and skill, beside an own rule, subagent and skill. */
const EDITED_AND_OWN = {
  ".agents/skills/ask/SKILL.md": "---\nname: ask\n---\nedited\n",
  ".agents/skills/deploy/SKILL.md": "deploy\n",
  ".rulesync/rules/plain.md": "---\nroot: false\n---\nedited plain\n",
  ".rulesync/rules/team.md": "own\n",
  ".rulesync/subagents/mine.md": "own\n",
  ".rulesync/subagents/scout.md": "---\nname: scout\n---\nedited scout\n",
};

it("marks a moved stock rule, subagent and skill, and nothing else", async () => {
  const m = mini(EDITED_AND_OWN, STOCK_PLAIN);
  const lines = await applyMigration(m.root, planOf(m));
  expect(lines).toContain(
    "repo sync: moved your edited .rulesync/rules/plain.md to .repo/rules/plain.md (it now replaces the stock rule)",
  );
  expect(lines).toContain("repo sync: marked .repo/rules/plain.md with overrides: plain (it replaces the stock rule)");
  expect(lines).toContain(
    "repo sync: marked .repo/subagents/scout.md with overrides: scout (it replaces the stock subagent)",
  );
  expect(lines).toContain(
    "repo sync: marked .repo/skills/ask/SKILL.md with overrides: ask (it replaces the stock skill)",
  );
  expect(lines.filter((line) => line.includes("marked"))).toHaveLength(3);
  expect(read(m.root, ".repo/rules/plain.md")).toBe("---\noverrides: plain\nroot: false\n---\nedited plain\n");
  expect(read(m.root, ".repo/subagents/scout.md")).toBe("---\noverrides: scout\nname: scout\n---\nedited scout\n");
  expect(read(m.root, ".repo/skills/ask/SKILL.md")).toBe("---\noverrides: ask\nname: ask\n---\nedited\n");
  expect(read(m.root, ".repo/rules/team.md")).toBe("own\n");
  expect(read(m.root, ".repo/subagents/mine.md")).toBe("own\n");
  expect(read(m.root, ".repo/skills/deploy/SKILL.md")).toBe("deploy\n");
});

it("frames a file with no frontmatter", async () => {
  const m = mini({ ".agents/skills/ask/SKILL.md": "edited\n" });
  await applyMigration(m.root, planOf(m));
  expect(read(m.root, ".repo/skills/ask/SKILL.md")).toBe("---\noverrides: ask\n---\nedited\n");
});

it("does not double a mark that a stopped run already made", async () => {
  const m = mini({ ".agents/skills/ask/SKILL.md": "---\noverrides: ask\n---\nedited\n" });
  const lines = await applyMigration(m.root, planOf(m));
  expect(read(m.root, ".repo/skills/ask/SKILL.md")).toBe("---\noverrides: ask\n---\nedited\n");
  expect(lines.filter((line) => line.includes("marked"))).toStrictEqual([]);
});

it("moves a stock rule whose frontmatter does not parse without marking it", async () => {
  const broken = "---\n: [\n---\nedited plain\n";
  const m = mini({ ".rulesync/rules/plain.md": broken }, STOCK_PLAIN);
  const lines = await applyMigration(m.root, planOf(m));
  expect(lines.filter((line) => line.includes("marked"))).toStrictEqual([]);
  expect(read(m.root, ".repo/rules/plain.md")).toBe(broken);
});

it("moves an edited stock skill that has no SKILL.md without a mark", async () => {
  const m = mini({ ".agents/skills/ask/extra.md": "mine\n" });
  const lines = await applyMigration(m.root, planOf(m));
  expect(lines.filter((line) => line.includes("marked"))).toStrictEqual([]);
  expect(read(m.root, ".repo/skills/ask/extra.md")).toBe("mine\n");
});

it("keeps CRLF line endings when it marks, and frames a frontmatter that never closes", async () => {
  const m = mini(
    {
      ".rulesync/rules/plain.md": "---\r\nroot: false\r\n---\r\nedited\r\n",
      ".rulesync/subagents/scout.md": "---\nname: scout\nunclosed\n",
    },
    STOCK_PLAIN,
  );

  await applyMigration(m.root, planOf(m));
  expect(read(m.root, ".repo/rules/plain.md")).toBe("---\r\noverrides: plain\r\nroot: false\r\n---\r\nedited\r\n");
  expect(read(m.root, ".repo/subagents/scout.md")).toBe("---\noverrides: scout\n---\n---\nname: scout\nunclosed\n");
});

it("marks an adopted skill that bears a stock name, so the first sync passes", async () => {
  const root = tempDir("workerstack-migrate-");
  write(root, "workerstack.config.ts", "export default {}\n");
  write(root, "package.json", JSON.stringify({ name: "fixture" }));
  write(root, ".claude/skills/ask/SKILL.md", "---\nname: ask\ndescription: mine\n---\nmy ask\n");
  linkStock(root);
  const result = await sync(root, [], true);
  expect(result.err).toStrictEqual([]);
  expect(result.code).toBe(0);
  expect(result.out.join("")).toContain(
    "repo sync: marked .repo/skills/ask/SKILL.md with overrides: ask (it replaces the stock skill)\n",
  );
  expect(read(root, ".repo/skills/ask/SKILL.md")).toContain("overrides: ask");
}, 120_000);
