import fs from "node:fs";
import path from "node:path";

import { expect, it } from "vitest";

import { BASE_CONFIG } from "../__fixtures__/base-config.ts";
import type { ResolvedConfig } from "../config.ts";
import { exists, read, write } from "./__fixtures__/copied-install.ts";
import { DEFINE, REMOVAL, SIMPLE_CONFIG, mini, notes, planOf } from "./__fixtures__/mini-install.ts";
import { useTempDirs } from "./__fixtures__/temp-dirs.ts";
import { applyMigration } from "./apply-migration.ts";
import { COPIED_MARKER } from "./migrate.constants.ts";

useTempDirs();

const CONFIG_FILE = "workerstack.config.ts";
function packs(text: string) {
  return { ".rulesync/repo.features.jsonc": text };
}
const MOVED =
  'moved packs ["speak", "clasp"] from .rulesync/repo.features.jsonc to agents.skills in workerstack.config.ts';
const ASK =
  'could not add the packs ["listen"] of .rulesync/repo.features.jsonc to workerstack.config.ts; ' +
  'add agents: { skills: ["listen"] } there';
const LISTEN = '{ "packs": ["listen"] }';

it("inserts agents.skills for each known pack once, in the config's line endings", async () => {
  const m = mini(packs('// packs\n{ "packs": ["speak", "bogus", "speak", "clasp"] }'));
  write(m.root, CONFIG_FILE, SIMPLE_CONFIG.replaceAll("\n", "\r\n"));
  const steps = planOf(m);
  expect(notes(steps)).toStrictEqual([MOVED]);
  expect(await applyMigration(m.root, steps)).toContain(`repo sync: ${MOVED}`);
  expect(read(m.root, CONFIG_FILE)).toBe(
    [DEFINE, 'export default defineConfig({\n  agents: { skills: ["speak", "clasp"] },\n', '  packs: ["agents"],\n})\n']
      .join("")
      .replaceAll("\n", "\r\n"),
  );
});

it("adds agents to a packs list that lacks it, so the moved agents.skills stays valid", async () => {
  const m = mini(packs('{ "packs": ["speak"] }'));
  write(m.root, CONFIG_FILE, `${DEFINE}export default defineConfig({\n  packs: ["docs"],\n})\n`);
  await applyMigration(m.root, planOf(m));
  const text = read(m.root, CONFIG_FILE);
  expect(text).toContain('agents: { skills: ["speak"] }');
  expect(text).toMatch(/packs: \[[^\]]*"docs"[^\]]*\]/);
  expect(text).toMatch(/packs: \[[^\]]*"agents"[^\]]*\]/);
});

it("puts agents alone into an empty packs list", async () => {
  const m = mini(packs('{ "packs": ["speak"] }'));
  write(m.root, CONFIG_FILE, `${DEFINE}export default defineConfig({ packs: [] })\n`);
  await applyMigration(m.root, planOf(m));
  expect(read(m.root, CONFIG_FILE)).toBe(
    `${DEFINE}export default defineConfig({\n  agents: { skills: ["speak"] }, packs: ["agents"] })\n`,
  );
});

it("plans nothing for no packs, a features file that is not JSON, or packs the config already lists", () => {
  expect(planOf(mini(packs('{ "packs": [] }')))).toStrictEqual([REMOVAL]);
  expect(planOf(mini(packs("{")))).toStrictEqual([REMOVAL]);
  expect(planOf(mini(packs('{ "packs": "listen" }')))).toStrictEqual([REMOVAL]);
  const listed = mini(packs(LISTEN));
  write(listed.root, CONFIG_FILE, `${DEFINE}export default defineConfig({ agents: { skills: ['listen'] } })\n`);
  expect(planOf(listed)).toStrictEqual([REMOVAL]);
});

it("asks the user to add the key when the config has an agents key without the pack, or no defineConfig call", () => {
  const own = mini(packs(LISTEN));
  write(own.root, CONFIG_FILE, `${DEFINE}export default defineConfig({ "agents": { hosts: ["claude"] } })\n`);
  expect(planOf(own)[0]).toStrictEqual({ kind: "note", note: ASK });
  const plain = mini(packs(LISTEN));
  write(plain.root, CONFIG_FILE, "export default {}\n");
  expect(planOf(plain)[0]).toStrictEqual({ kind: "note", note: ASK });
});

it("puts the config back and says so when the inserted key does not take effect", async () => {
  const m = mini(packs(LISTEN));
  const before = `${DEFINE}// call defineConfig({ later\nexport default defineConfig(\n  { packs: ["agents"] },\n)\n`;
  write(m.root, CONFIG_FILE, before);
  const steps = planOf(m);
  expect(steps[0]).toMatchObject({ kind: "write", path: CONFIG_FILE });
  expect(await applyMigration(m.root, steps)).toContain(
    'repo sync: could not add agents.skills ["listen"] to workerstack.config.ts; ' +
      'add agents: { skills: ["listen"] } there',
  );
  expect(read(m.root, CONFIG_FILE)).toBe(before);
});

it("lists only the generated paths of the enabled hosts that git tracks, and never the user's .mcp.json", () => {
  const m = mini(
    {
      ".claude/settings.json": "{}\n",
      ".cursor/hooks.json": "{}\n",
      ".mcp.json": "{}\n",
      ".vscode/tasks.json": "{}\n",
      "AGENTS.md": "x\n",
    },
    { git: true },
  );
  const claudeOnly: ResolvedConfig = { agents: { hosts: ["claude"], skills: [] }, packs: ["agents"], ...BASE_CONFIG };
  expect(planOf(m, claudeOnly).find((step) => step.kind === "untrack")).toStrictEqual({
    kind: "untrack",
    paths: ["AGENTS.md", ".claude/"],
  });
  expect(planOf(m).find((step) => step.kind === "untrack")).toStrictEqual({
    kind: "untrack",
    paths: ["AGENTS.md", ".claude/", ".cursor/"],
  });
});

it("plans no untrack when nothing generated is tracked, or when git cannot answer", () => {
  expect(planOf(mini({ "package.json": "{}\n" }, { git: true }))).toStrictEqual([REMOVAL]);
  const broken = mini({ ".mcp.json": "{}\n" });
  fs.mkdirSync(path.join(broken.root, ".git"));
  expect(planOf(broken)).toStrictEqual([REMOVAL]);
});

it("stops with the git message when the index cannot be changed, and leaves the copy for the next run", async () => {
  const m = mini({ "AGENTS.md": "x\n" }, { git: true });
  fs.writeFileSync(path.join(m.root, ".git", "index.lock"), "");
  await expect(applyMigration(m.root, planOf(m))).rejects.toThrow(/git rm --cached failed: .*index\.lock/s);
  expect(exists(m.root, COPIED_MARKER)).toBe(true);
  fs.rmSync(path.join(m.root, ".git", "index.lock"));
  expect(await applyMigration(m.root, planOf(m))).toStrictEqual([
    "repo sync: untracked AGENTS.md (now generated) and removed the copied .rulesync/; commit the result",
  ]);
});
