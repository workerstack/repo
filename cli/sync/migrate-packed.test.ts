import fs from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";
import { planAdoption, type MigrateDeps } from "./migrate.ts";
import { CONFIG, SELF_ROOT, read, write } from "./fixtures/copied-install.ts";
import { MARKER_FILE, REMOVAL, SIMPLE_CONFIG, fileOutput, planOf, type Mini } from "./fixtures/mini-install.ts";
import { tempDir, useTempDirs } from "./fixtures/temp-dirs.ts";

useTempDirs();

const CONSUMER_STOCK = path.join(SELF_ROOT, "cli", "sync", "fixtures", "consumer-stock");
const RULE = "agents/rules/overview.md";
const SETTINGS = '{ "permissions": { "deny": ["Agent(Explore)"] } }\n';
const generated = new Map([[".claude/settings.json", SETTINGS]]);
const none: MigrateDeps = { history: {}, tracked: () => null };
const RULE_FRONTMATTER = "---\ndescription: Carried over from your earlier setup\n---\n";
const outputs = [...generated].map(([rel, content]) => fileOutput(rel, content));

/** A copied install over the frozen stock snapshot: `agents/` and `cli/scripts/`, no `.rulesync/`, no generated trees. */
function packed(files: Record<string, string>): Mini {
  const dir = tempDir("workerstack-migrate-");
  const stock = path.join(dir, "stock");
  const root = path.join(dir, "root");
  fs.cpSync(CONSUMER_STOCK, stock, { recursive: true });
  write(stock, "package.json", '{ "name": "@workerstack/repo" }\n');
  write(stock, "agents/skills/ask/SKILL.md", "ask\n");
  for (const [rel, text] of Object.entries({ ...MARKER_FILE, "workerstack.config.ts": SIMPLE_CONFIG, ...files }))
    write(root, rel, text);
  return { root, stock, generated };
}

/** The adoption planned for `m` against the packed stock's generated outputs, or none. */
const adoptionOf = (m: Mini, withOutputs = false) =>
  planAdoption(m.root, { stock: m.stock, config: CONFIG, outputs: withOutputs ? outputs : [], manifest: [] }, none);

it("splits the extra sections of an edited stock rule into a -local file", () => {
  const own = `${read(CONSUMER_STOCK, RULE)}\n## Ours\n\nship on Fridays\n`;
  expect(planOf(packed({ ".rulesync/rules/overview.md": own }), CONFIG, none)).toEqual([
    {
      kind: "write",
      path: ".repo/rules/overview-local.md",
      content: `${RULE_FRONTMATTER}## Ours\n\nship on Fridays\n`,
      note: 'moved your sections "Ours" of .rulesync/rules/overview.md to .repo/rules/overview-local.md',
    },
    REMOVAL,
  ]);
});

it("moves an own key of .claude/settings.json to .repo/settings/claude.json", () => {
  const own = JSON.stringify({ permissions: { deny: ["Agent(Explore)"] }, model: "opus" });
  expect(planOf(packed({ ".claude/settings.json": own }), CONFIG, none)).toEqual([
    {
      kind: "write",
      path: ".repo/settings/claude.json",
      content: `${JSON.stringify({ model: "opus" }, null, 2)}\n`,
      note: "moved your .claude/settings.json keys model to .repo/settings/claude.json",
    },
    { kind: "remove", paths: [".claude/settings.json", ".rulesync"] },
  ]);
});

it("removes an unedited copy of a stock skill instead of moving it", () => {
  expect(planOf(packed({ ".agents/skills/ask/SKILL.md": "ask\n" }), CONFIG, none)).toEqual([
    { kind: "remove", paths: [".agents/skills/ask", ".rulesync"] },
  ]);
});

it("leaves an unedited real copy of a stock skill under .claude/skills alone, and moves one with an extra file", () => {
  expect(adoptionOf(packed({ ".claude/skills/ask/SKILL.md": "ask\n" }))).toEqual([]);
  const edited = packed({ ".claude/skills/ask/SKILL.md": "ask\n", ".claude/skills/ask/notes.md": "mine\n" });
  expect(adoptionOf(edited)).toEqual([
    {
      kind: "move",
      from: ".claude/skills/ask",
      to: ".repo/skills/ask",
      note: "moved .claude/skills/ask to .repo/skills/ask",
      mark: {
        path: ".claude/skills/ask/SKILL.md",
        content: "---\noverrides: ask\n---\nask\n",
        note: "marked .repo/skills/ask/SKILL.md with overrides: ask (it replaces the stock skill)",
      },
    },
  ]);
});

it("moves no server of .mcp.json: the file is the user's", () => {
  const m = packed({
    ".mcp.json": JSON.stringify({ mcpServers: { stock: { command: "s" }, docs: { command: "d" } } }),
  });
  expect(adoptionOf(m, true)).toEqual([]);
});

it("writes .repo/settings/claude.json with its keys sorted by code unit, deep", () => {
  const own = JSON.stringify({ zeta: 1, alpha: { b: 1, a: 2 }, Beta: true });
  const plan = planOf(packed({ ".claude/settings.json": own }), CONFIG, none);
  const written = plan.find((step) => step.kind === "write");
  expect(written).toMatchObject({
    path: ".repo/settings/claude.json",
    content: '{\n  "Beta": true,\n  "alpha": {\n    "a": 2,\n    "b": 1\n  },\n  "zeta": 1\n}\n',
  });
});
