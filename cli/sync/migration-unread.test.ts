import { expect, it } from "vitest";
import { applyMigration } from "./apply-migration.ts";
import { conflictLines, type MigrateDeps } from "./migrate.ts";
import { hashText } from "./stock-history.ts";
import { CONFIG, read } from "./fixtures/copied-install.ts";
import { REMOVAL, mini, notes, planOf, yours } from "./fixtures/mini-install.ts";
import { useTempDirs } from "./fixtures/temp-dirs.ts";

useTempDirs();

const none: MigrateDeps = { history: {} };
const OVERRIDE_NOTE =
  "moved your edited .rulesync/rules/overview.md to .repo/rules/overview.md (it now replaces the stock rule)";

it("moves a stock-named rule edited inside its sections whole, as an override", async () => {
  const m = mini({ ".rulesync/rules/overview.md": "---\nroot: true\n---\n# Overview\n\n## Stock\n\nedited body\n" });
  const steps = planOf(m, CONFIG, none);
  expect(notes(steps)).toEqual([OVERRIDE_NOTE]);
  expect(await applyMigration(m.root, steps)).toContain(`repo sync: ${OVERRIDE_NOTE}`);
  expect(read(m.root, ".repo/rules/overview.md")).toContain("edited body");
});

it("moves a stock-named reference edited inside its sections to references/", () => {
  const m = mini({ ".rulesync/reference/cascade.md": "# Cascade\n\n## Stock\n\nedited\n" });
  expect(notes(planOf(m, CONFIG, none))).toEqual([
    "moved your edited .rulesync/reference/cascade.md to references/cascade.md",
  ]);
});

it("stops on scripts, the pipeline file and settings other than claude.json that match no stock version, and drops those that do", () => {
  const m = mini(
    {
      ".rulesync/scripts/mine.ts": "export {}\n",
      ".rulesync/scripts/deep/tool.ts": "export {}\n",
      ".rulesync/scripts/stock.ts": "stock script\n",
      ".rulesync/repo.pipeline.jsonc": '{ "mine": 1 }\n',
      ".rulesync/settings/claude.json": "{}\n",
      ".rulesync/settings/codex.json": "{}\n",
    },
    { stock: { "cli/scripts/stock.ts": "stock script\n" } },
  );
  const steps = planOf(m, CONFIG, none);
  expect(conflictLines(steps)).toEqual([
    yours(".rulesync/scripts/deep/tool.ts"),
    yours(".rulesync/scripts/mine.ts"),
    yours(".rulesync/settings/codex.json"),
    yours(".rulesync/repo.pipeline.jsonc"),
  ]);
  // An edited settings/claude.json is the overlay's own file and keeps moving there.
  expect(notes(steps)).toEqual(["moved your .rulesync/settings/claude.json to .repo/settings/claude.json"]);
  const old = hashText("old script\n");
  const known = mini(
    { ".rulesync/scripts/old.ts": "old script\n", ".rulesync/repo.pipeline.jsonc": "{}\n" },
    { stock: { "agents/repo.pipeline.jsonc": "{}\n" } },
  );
  expect(planOf(known, CONFIG, { history: { ".rulesync/scripts/old.ts": [old] } })).toEqual([REMOVAL]);
});

it("stops on any other entry of the copied dir, one line per entry, and leaves reference and the features file to their own handling", () => {
  const m = mini({
    ".rulesync/notes.md": "mine\n",
    ".rulesync/misc/a.txt": "a\n",
    ".rulesync/repo.features.jsonc": "{}\n",
    ".rulesync/reference/deploy.md": "# Deploy\n",
  });
  const steps = planOf(m, CONFIG, none);
  expect(conflictLines(steps)).toEqual([yours(".rulesync/misc"), yours(".rulesync/notes.md")]);
  expect(notes(steps)).toEqual(["moved .rulesync/reference/deploy.md to references/deploy.md"]);
});

it("moves a folder found where a rule, subagent or global setting should be", () => {
  const m = mini({
    ".rulesync/rules/folder/a.md": "a\n",
    ".rulesync/subagents/folder/b.md": "b\n",
    ".rulesync/global-settings/folder/c.json": "{}\n",
  });
  expect(notes(planOf(m, CONFIG, none))).toEqual([
    "moved .rulesync/rules/folder to .repo/rules/folder",
    "moved .rulesync/subagents/folder to .repo/subagents/folder",
    "moved your .rulesync/global-settings/folder to .repo/global-settings/folder",
  ]);
});

it("refuses to overwrite a differing file when a move meets one written earlier in the run", async () => {
  const m = mini({ ".rulesync/settings/claude.json": '{ "a": 1 }\n', ".repo/settings/claude.json": '{ "b": 2 }\n' });
  await expect(
    applyMigration(m.root, [
      { kind: "move", from: ".rulesync/settings/claude.json", to: ".repo/settings/claude.json", note: "x" },
    ]),
  ).rejects.toThrow(/already exists and differs/);
  expect(read(m.root, ".rulesync/settings/claude.json")).toBe('{ "a": 1 }\n');
});
