import fs from "node:fs";
import path from "node:path";

import { expect, it } from "vitest";

import { CONFIG, SELF_ROOT, read, write } from "./__fixtures__/copied-install.ts";
import { MARKER_FILE, REMOVAL, SIMPLE_CONFIG, fileOutput, planOf, type Mini } from "./__fixtures__/mini-install.ts";
import { tempDir, useTempDirs } from "./__fixtures__/temp-dirs.ts";
import { planAdoption, type MigrateDeps } from "./migrate.ts";

useTempDirs();

const CONSUMER_STOCK = path.join(SELF_ROOT, "cli", "sync", "__fixtures__", "consumer-stock");
const RULE = "agents/rules/overview.md";
const SETTINGS = '{ "permissions": { "deny": ["Agent(Explore)"] } }\n';
const generated = new Map([[".claude/settings.json", SETTINGS]]);
const none: MigrateDeps = { history: {}, tracked: () => null };
const RULE_FRONTMATTER = "---\ndescription: Carried over from your earlier setup\n---\n";
const outputs = [...generated].map(([rel, content]) => fileOutput(rel, content));

/**
 * A copied install over the frozen stock snapshot: `agents/` and `cli/scripts/`, no `.rulesync/`, no generated
 * trees.
 */
function packed(files: Record<string, string>): Mini {
  const dir = tempDir("workerstack-migrate-");
  const stock = path.join(dir, "stock");
  const root = path.join(dir, "root");
  fs.cpSync(CONSUMER_STOCK, stock, { recursive: true });
  write(stock, "package.json", '{ "name": "@workerstack/repo" }\n');
  write(stock, "agents/skills/ask/SKILL.md", "ask\n");
  for (const [rel, text] of Object.entries({ ...MARKER_FILE, "workerstack.config.ts": SIMPLE_CONFIG, ...files }))
    write(root, rel, text);
  return { generated, root, stock };
}

/** The adoption planned for `m` against the packed stock's generated outputs, or none. */
function adoptionOf(m: Mini, { withOutputs = false } = {}) {
  return planAdoption(
    m.root,
    { config: CONFIG, manifest: [], outputs: withOutputs ? outputs : [], stock: m.stock },
    none,
  );
}

it("splits the extra sections of an edited stock rule into a -local file", () => {
  const own = `${read(CONSUMER_STOCK, RULE)}\n## Ours\n\nship on Fridays\n`;
  expect(planOf(packed({ ".rulesync/rules/overview.md": own }), CONFIG, none)).toStrictEqual([
    {
      content: `${RULE_FRONTMATTER}## Ours\n\nship on Fridays\n`,
      kind: "write",
      note: 'moved your sections "Ours" of .rulesync/rules/overview.md to .repo/rules/overview-local.md',
      path: ".repo/rules/overview-local.md",
    },
    REMOVAL,
  ]);
});

it("moves an own key of .claude/settings.json to .repo/settings/claude.json", () => {
  const own = JSON.stringify({ model: "opus", permissions: { deny: ["Agent(Explore)"] } });
  expect(planOf(packed({ ".claude/settings.json": own }), CONFIG, none)).toStrictEqual([
    {
      content: `${JSON.stringify({ model: "opus" }, null, 2)}\n`,
      kind: "write",
      note: "moved your .claude/settings.json keys model to .repo/settings/claude.json",
      path: ".repo/settings/claude.json",
    },
    { kind: "remove", paths: [".claude/settings.json", ".rulesync"] },
  ]);
});

it("removes an unedited copy of a stock skill instead of moving it", () => {
  expect(planOf(packed({ ".agents/skills/ask/SKILL.md": "ask\n" }), CONFIG, none)).toStrictEqual([
    { kind: "remove", paths: [".agents/skills/ask", ".rulesync"] },
  ]);
});

it("leaves an unedited real copy of a stock skill under .claude/skills alone, and moves one with an extra file", () => {
  expect(adoptionOf(packed({ ".claude/skills/ask/SKILL.md": "ask\n" }))).toStrictEqual([]);
  const edited = packed({ ".claude/skills/ask/SKILL.md": "ask\n", ".claude/skills/ask/notes.md": "mine\n" });
  expect(adoptionOf(edited)).toStrictEqual([
    {
      from: ".claude/skills/ask",
      kind: "move",
      mark: {
        content: "---\noverrides: ask\n---\nask\n",
        note: "marked .repo/skills/ask/SKILL.md with overrides: ask (it replaces the stock skill)",
        path: ".claude/skills/ask/SKILL.md",
      },
      note: "moved .claude/skills/ask to .repo/skills/ask",
      to: ".repo/skills/ask",
    },
  ]);
});

it("moves no server of .mcp.json: the file is the user's", () => {
  const m = packed({
    ".mcp.json": JSON.stringify({ mcpServers: { docs: { command: "d" }, stock: { command: "s" } } }),
  });
  expect(adoptionOf(m, { withOutputs: true })).toStrictEqual([]);
});

it("writes .repo/settings/claude.json with its keys sorted by code unit, deep", () => {
  const own = JSON.stringify({ Beta: true, alpha: { a: 2, b: 1 }, zeta: 1 });
  const plan = planOf(packed({ ".claude/settings.json": own }), CONFIG, none);
  const written = plan.find((step) => step.kind === "write");
  expect(written).toMatchObject({
    content: '{\n  "Beta": true,\n  "alpha": {\n    "a": 2,\n    "b": 1\n  },\n  "zeta": 1\n}\n',
    path: ".repo/settings/claude.json",
  });
});
