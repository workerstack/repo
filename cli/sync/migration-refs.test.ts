import fs from "node:fs";
import path from "node:path";

import { expect, it } from "vitest";

import { exists, read } from "./__fixtures__/copied-install.ts";
import { REMOVAL, STOCK_HOOKS_REF, clash, contents, mini, notes, planOf, yours } from "./__fixtures__/mini-install.ts";
import { useTempDirs } from "./__fixtures__/temp-dirs.ts";
import { applyMigration } from "./apply-migration.ts";
import { conflictLines } from "./migrate.ts";

useTempDirs();

it("drops old generated files and stock copies, writes extra sections, moves everything else", () => {
  const m = mini({
    ".rulesync/reference/INDEX.md": "generated\n",
    ".rulesync/reference/bare.md": "bare\n\n## Stock\n\nbody\n\n## C\n\nthree\n",
    ".rulesync/reference/cascade.md": "# Cascade\n\n## Stock\n\nbody\n",
    ".rulesync/reference/deploy.md": "# Deploy\n",
    ".rulesync/reference/hooks.md": "# Hooks\n\n## Stock\n\nbody\n\n## A\n\n1\n\n## B\n\n2\n",
    ".rulesync/reference/law.md": "# Law\n",
    ".rulesync/reference/nested/more.md": "# More\n",
    ".rulesync/reference/notes.txt": "not markdown\n",
  });

  const steps = planOf(m);
  expect(notes(steps)).toStrictEqual([
    'moved your sections "C" of .rulesync/reference/bare.md to references/bare.md',
    'moved your sections "A", "B" of .rulesync/reference/hooks.md to references/hooks.md',
    "moved .rulesync/reference/deploy.md to references/deploy.md",
    "moved .rulesync/reference/nested to references/nested",
    "moved .rulesync/reference/notes.txt to references/notes.txt",
  ]);
  expect(contents(steps)).toStrictEqual(["# bare.md\n\n## C\n\nthree\n", "# Hooks\n\n## A\n\n1\n\n## B\n\n2\n"]);
});

it("takes the heading from the consumer's copy when the stock has none, then from the file name", () => {
  const m = mini(
    {
      ".rulesync/reference/a.md": "# Mine\n\n## S\n\nx\n\n## Own\n\ny\n",
      ".rulesync/reference/b.md": "text\n\n## S\n\nx\n\n## Own\n\ny\n",
    },
    { stock: { "references/a.md": "stock\n\n## S\n\nx\n", "references/b.md": "stock\n\n## S\n\nx\n" } },
  );

  expect(contents(planOf(m))).toStrictEqual(["# Mine\n\n## Own\n\ny\n", "# b.md\n\n## Own\n\ny\n"]);
});

it("appends extra sections after text already at the destination, and does nothing when they are there", () => {
  const own = ".rulesync/reference/hooks.md";
  const text = "# Hooks\n\n## Stock\n\nbody\n\n## Ours\n\nmine\n";
  const appended = mini({ [own]: text, "references/hooks.md": "# Hooks\n\nconsumer text\n\n" });
  expect(contents(planOf(appended))).toStrictEqual(["# Hooks\n\nconsumer text\n\n## Ours\n\nmine\n"]);
  const there = mini({ [own]: text, "references/hooks.md": "# Hooks\n\n## Ours\n\nmine\n" });
  expect(planOf(there)).toStrictEqual([REMOVAL]);
  const same = mini({ [own]: STOCK_HOOKS_REF });
  expect(planOf(same)).toStrictEqual([REMOVAL]);
});

it("stops on a moved file whose destination holds other text, and on a dir against a file", () => {
  const m = mini({
    ".rulesync/reference/deploy.md": "# Deploy\n",
    ".rulesync/reference/guide/one.md": "1\n",
    "references/deploy.md": "# Other\n",
    "references/guide": "a file\n",
  });

  expect(conflictLines(planOf(m))).toStrictEqual([
    clash(".rulesync/reference/deploy.md", "references/deploy.md"),
    clash(".rulesync/reference/guide", "references/guide"),
  ]);
});

it("moves lessons into an existing .repo/lessons, leaves INDEX.md, and drops an identical file", async () => {
  const m = mini({
    ".repo/lessons/INDEX.md": "new index\n",
    ".repo/lessons/b.md": "b\n",
    ".repo/lessons/sub/d.md": "d\n",
    ".rulesync/lessons/INDEX.md": "old index\n",
    ".rulesync/lessons/a.md": "a\n",
    ".rulesync/lessons/b.md": "b\n",
    ".rulesync/lessons/sub/c.md": "c\n",
  });

  const steps = planOf(m);
  expect(notes(steps)).toStrictEqual(["moved .rulesync/lessons/ (3) to .repo/lessons/"]);
  await applyMigration(m.root, steps);
  expect(read(m.root, ".repo/lessons/a.md")).toBe("a\n");
  expect(read(m.root, ".repo/lessons/sub/c.md")).toBe("c\n");
  expect(read(m.root, ".repo/lessons/sub/d.md")).toBe("d\n");
  expect(read(m.root, ".repo/lessons/INDEX.md")).toBe("new index\n");
  expect(exists(m.root, ".rulesync")).toBe(false);
});

it("plans nothing for a lessons dir that holds only its index, and stops on a differing lesson", () => {
  expect(planOf(mini({ ".rulesync/lessons/INDEX.md": "x\n" }))).toStrictEqual([REMOVAL]);
  const m = mini({ ".repo/lessons/a.md": "other\n", ".rulesync/lessons/a.md": "a\n" });
  expect(conflictLines(planOf(m))).toStrictEqual([clash(".rulesync/lessons", ".repo/lessons")]);
});

it("moves permissions.json and each global-settings file that differs from stock, and no identical file", () => {
  const m = mini(
    {
      ".rulesync/global-settings/claude.json": "{}\n",
      ".rulesync/global-settings/codex.toml": "x = 1\n",
      ".rulesync/global-settings/grok.toml": "y = 1\n",
      ".rulesync/hooks.jsonc": "{}\r\n",
      ".rulesync/mcp-policy.jsonc": "{}\n",
      ".rulesync/permissions.json": '{ "deny": [] }\n',
    },
    { stock: { "agents/global-settings/grok.toml": "y = 2\n" } },
  );

  expect(notes(planOf(m))).toStrictEqual([
    "moved your .rulesync/permissions.json to .repo/permissions.json",
    "moved your .rulesync/global-settings/codex.toml to .repo/global-settings/codex.toml",
    "moved your .rulesync/global-settings/grok.toml to .repo/global-settings/grok.toml (it now replaces the stock one)",
  ]);
});

it("stops on any other entry of the copied dir and changes nothing", async () => {
  const m = mini({ ".rulesync/custom.md": "mine\n", ".rulesync/repo.features.jsonc": "{}\n" });
  expect(conflictLines(planOf(m))).toStrictEqual([yours(".rulesync/custom.md")]);
  expect(await applyMigration(m.root, planOf(m))).toStrictEqual([yours(".rulesync/custom.md")]);
  expect(fs.existsSync(path.join(m.root, ".repo/custom.md"))).toBe(false);
  expect(read(m.root, ".rulesync/custom.md")).toBe("mine\n");
});
