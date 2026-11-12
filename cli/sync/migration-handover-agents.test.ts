/**
 * The handover over an old root `AGENTS.md` that held stock rules: the rule bodies move to the end, the stock rules
 * stay where they stood, and sync's `agentsFile` puts the region in their place.
 */
import fs from "node:fs";
import path from "node:path";

import { expect, it } from "vitest";

import { NONE, PATHLESS, read, rootWith } from "./__fixtures__/handover-kit.ts";
import { useTempDirs } from "./__fixtures__/temp-dirs.ts";
import { agentsFile } from "./agents-file.ts";
import { applyMigration } from "./apply-migration.ts";
import type { MigrationStep } from "./migrate.ts";
import { planHandover } from "./migration-handover.ts";
import type { Output } from "./outputs.ts";
import { regionHash } from "./region.ts";
import { hashText } from "./stock-history.ts";

useTempDirs();

const STOCK = "# Agents\n\nThe stock rules an old install shipped.\n- Keep it short.\n";
const STOCK_LINE = "The stock rules an old install shipped.";
const STOCK_HISTORY = { "AGENTS.md": [hashText(STOCK)] };
const BODY = "Stock rule.\n";
const REGION = `<!-- repo:rules ${regionHash(BODY)} -->\n${BODY}<!-- /repo:rules -->\n`;

/** `AGENTS.md` as the handover writes it, then as sync's `agentsFile` writes it over that, as one sync runs them. */
async function synced(agents: string, stock = { body: BODY, history: STOCK_HISTORY }) {
  const root = rootWith({ ".repo/rules/agents.md": PATHLESS, "AGENTS.md": agents });
  await applyMigration(root, planHandover(root, { history: stock.history, packages: [] }));
  const handed = read(root, "AGENTS.md");
  const final: Output = agentsFile("AGENTS.md", stock.body, { history: stock.history, text: handed });

  return { final, handed };
}

it("keeps an old file's stock rules where they stood, so the region takes their place in the same sync", async () => {
  const { handed, final } = await synced(`USER-ABOVE\n\n${STOCK}\nUSER-BELOW\n`);
  expect(handed).toBe(`USER-ABOVE\n\n${STOCK}\nUSER-BELOW\n\nAlways run the linter.\n`);
  expect(final).toMatchObject({
    content: `USER-ABOVE\n\n${REGION}\nUSER-BELOW\n\nAlways run the linter.\n`,
    repairs: ["replaced the old stock rules with repo:rules"],
  });
});

it("ends an unedited old file with a rule handover as the region on top, then the rule", async () => {
  const { handed, final } = await synced(STOCK);
  expect(handed.split(STOCK_LINE)).toHaveLength(2);
  expect(final).toMatchObject({ content: `${REGION}\nAlways run the linter.\n` });
});

it("keeps stock rules with no newline after them, the user's lines above", async () => {
  const { handed, final } = await synced(`USER-ABOVE\n${STOCK.trimEnd()}`);
  expect(handed).toBe(`USER-ABOVE\n${STOCK}\nAlways run the linter.\n`);
  expect(final).toMatchObject({ content: `USER-ABOVE\n${REGION}\nAlways run the linter.\n` });
});

const HEAD = "# Agents\n\nThe stock head an old install shipped.\n";
const TAIL = "## Rules by path\n- `**/*.rs`: read `.repo/rules/rust.md`\n";

/** An old install's stock rules, composed with the pathless rule bodies between their head and their tail. */
const COMPOSED = { body: `Stock rule.\n\n${TAIL}`, history: { "AGENTS.md": [hashText(`${HEAD}\n${TAIL}`)] } };
const COMPOSED_REGION = `<!-- repo:rules ${regionHash(COMPOSED.body)} -->\n${COMPOSED.body}<!-- /repo:rules -->\n`;

it("moves a rule body out of the old stock rules it split, so the region replaces the whole of them", async () => {
  const { handed, final } = await synced(
    `USER-ABOVE\n\n${HEAD}\nAlways run the linter.\n\n${TAIL}\nUSER-BELOW\n`,
    COMPOSED,
  );

  expect(handed).toBe(`USER-ABOVE\n\n${HEAD}\n${TAIL}\nUSER-BELOW\n\nAlways run the linter.\n`);
  const content = `USER-ABOVE\n\n${COMPOSED_REGION}\nUSER-BELOW\n\nAlways run the linter.\n`;
  expect(final).toMatchObject({ content, repairs: ["replaced the old stock rules with repo:rules"] });
  expect(content.split(TAIL)).toHaveLength(2);
});

it.each([
  ["first in the file", "Always run the linter.\n\nMine.\n", "Mine.\n\nAlways run the linter.\n"],
  ["last, with no newline", "Mine.\n\nAlways run the linter.", "Mine.\n\nAlways run the linter.\n"],
  ["inside a paragraph of the user's", "Note:\nAlways run the linter.\n", "Note:\nAlways run the linter.\n"],
])("moves a rule body that stands %s to the end only as a paragraph of its own", async (_name, agents, moved) => {
  const root = rootWith({ ".repo/rules/team.md": PATHLESS, "AGENTS.md": agents });
  await applyMigration(root, planHandover(root, NONE));
  expect(read(root, "AGENTS.md")).toBe(moved);
});

it("leaves the blank lines of AGENTS.md alone for a rule with no body", async () => {
  const root = rootWith({ ".repo/rules/empty.md": "---\ndescription: Empty\n---\n", "AGENTS.md": "A\n\n\n\nB\n" });
  await applyMigration(root, planHandover(root, NONE));
  expect(read(root, "AGENTS.md")).toBe("A\n\n\n\nB\n");
  expect(fs.existsSync(path.join(root, ".repo/rules/empty.md"))).toBe(false);
});

it.each([
  ["after its first step", (step: MigrationStep) => step],
  ["between the first write and its remove", (step: MigrationStep) => ({ ...step, remove: [] })],
])("converges on a rerun of a move that stopped %s", async (_name, partial) => {
  const files = {
    ".repo/rules/agents.md": PATHLESS,
    ".repo/rules/zeta.md": "---\ndescription: Z\n---\nZ rule.\n",
    "AGENTS.md": `${HEAD}\nAlways run the linter.\n\nZ rule.\n\n${TAIL}`,
  };

  const input = { history: COMPOSED.history, packages: [] };
  const whole = rootWith(files);
  await applyMigration(whole, planHandover(whole, input));
  const stopped = rootWith(files);
  const [first] = planHandover(stopped, input);
  await applyMigration(stopped, first === undefined ? [] : [partial(first)]);
  await applyMigration(stopped, planHandover(stopped, input));
  expect(read(stopped, "AGENTS.md")).toBe(read(whole, "AGENTS.md"));
  expect(read(whole, "AGENTS.md")).toBe(`${HEAD}\n${TAIL}\nAlways run the linter.\n\nZ rule.\n`);
  expect(planHandover(stopped, input)).toStrictEqual([]);
});
