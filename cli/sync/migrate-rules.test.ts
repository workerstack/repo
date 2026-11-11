import fs from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";
import { applyMigration } from "./apply-migration.ts";
import { planRuleUpgrade } from "./migrate-rules.ts";
import { write } from "./fixtures/copied-install.ts";
import { contents, notes } from "./fixtures/mini-install.ts";
import { tempDir, useTempDirs } from "./fixtures/temp-dirs.ts";

useTempDirs();

const STOCK = {
  "package.json": '{ "name": "@workerstack/repo" }\n',
  "agents/rules/overview.md": "---\ndescription: Stock\n---\nstock\n",
  "agents/rules/deep/style.md": "---\ndescription: Stock\n---\nstock\n",
  "agents/subagents/scout.md": "---\nname: scout\n---\nstock\n",
};

/** A consumer holding `files` beside a fake stock package. */
function upgradeRoot(files: Record<string, string>): { root: string; stock: string } {
  const dir = tempDir("workerstack-migrate-");
  const stock = path.join(dir, "stock");
  const root = path.join(dir, "root");
  for (const [rel, text] of Object.entries(STOCK)) write(stock, rel, text);
  fs.mkdirSync(root, { recursive: true });
  for (const [rel, text] of Object.entries(files)) write(root, rel, text);
  return { root, stock };
}

const plan = (files: Record<string, string>) => {
  const { root, stock } = upgradeRoot(files);
  return { root, stock, steps: planRuleUpgrade(root, stock) };
};

it("rewrites globs to paths, drops root and targets, and takes the description from the first heading", () => {
  const { steps } = plan({
    ".repo/rules/testing.md":
      '---\nroot: false\ntargets: ["*"]\nglobs:\n  - src/**\n  - lib/**\n---\n# Testing rules\n\nBody.\n',
  });
  expect(steps).toStrictEqual([
    {
      kind: "write",
      path: ".repo/rules/testing.md",
      content: "---\ndescription: Testing rules\npaths:\n  - src/**\n  - lib/**\n---\n# Testing rules\n\nBody.\n",
      note: "rewrote .repo/rules/testing.md frontmatter (description added, globs → paths, root and targets dropped)",
    },
  ]);
});

it("falls back to the rule name for the description and reads comma-separated globs", () => {
  const { steps } = plan({ ".repo/rules/notes.md": '---\nglobs: "a/**, b/**"\n---\nNo heading.\n' });
  expect(contents(steps)).toStrictEqual(["---\ndescription: notes\npaths:\n  - a/**\n  - b/**\n---\nNo heading.\n"]);
});

it.each([['["**/*"]'], ['["*"]'], ['["src/**", "**/*"]']])("turns globs %s into no paths", (globs) => {
  const { steps } = plan({ ".repo/rules/all.md": `---\ndescription: Keep me\nglobs: ${globs}\n---\nBody.\n` });
  expect(contents(steps)).toStrictEqual(["---\ndescription: Keep me\n---\nBody.\n"]);
  expect(notes(steps)).toStrictEqual(["rewrote .repo/rules/all.md frontmatter (globs dropped)"]);
});

it("keeps the other keys and the body byte for byte", () => {
  const { steps } = plan({
    ".repo/rules/x.md": "---\n# a note\nroot: false\ndescription: D\nextra: 'v'\n---\n# H\n\n---\ntext  \n",
  });
  expect(contents(steps)).toStrictEqual(["---\n# a note\ndescription: D\nextra: 'v'\n---\n# H\n\n---\ntext  \n"]);
});

it("marks an old-format rule that bears a stock name, case-folded and nested, in the same step", () => {
  const { steps } = plan({
    ".repo/rules/Overview.md": "---\nroot: true\nglobs: ['**/*']\n---\n# Mine\n",
    ".repo/rules/deep/style.md": "---\nroot: false\n---\nBody\n",
  });
  expect(steps).toStrictEqual([
    {
      kind: "write",
      path: ".repo/rules/Overview.md",
      content: "---\ndescription: Mine\noverrides: Overview\n---\n# Mine\n",
      note: "rewrote .repo/rules/Overview.md frontmatter (description added, root and globs dropped)\nmarked .repo/rules/Overview.md with overrides: Overview (it replaces the stock rule)",
    },
    {
      kind: "write",
      path: ".repo/rules/deep/style.md",
      content: "---\ndescription: style\noverrides: deep/style\n---\nBody\n",
      note: "rewrote .repo/rules/deep/style.md frontmatter (description added, root dropped)\nmarked .repo/rules/deep/style.md with overrides: deep/style (it replaces the stock rule)",
    },
  ]);
});

it("never marks a new-format file, and leaves a new-format rule that lacks a description alone", () => {
  const { steps } = plan({
    ".repo/rules/overview.md": "---\ndescription: Mine\n---\nBody\n",
    ".repo/rules/style.md": "---\npaths: [a]\n---\nBody\n",
    ".repo/subagents/scout.md": "---\nname: scout\ndescription: mine\n---\nBody\n",
  });
  expect(steps).toStrictEqual([]);
});

it("does not mark an old-format file that bears no stock name", () => {
  const { steps } = plan({ ".repo/rules/team.md": "---\nroot: false\ndescription: Team\n---\nBody\n" });
  expect(contents(steps)).toStrictEqual(["---\ndescription: Team\n---\nBody\n"]);
});

it("keeps an overrides that is already there and never doubles it", () => {
  const { steps } = plan({
    ".repo/rules/overview.md": "---\nroot: true\ndescription: D\noverrides: overview\n---\nB\n",
  });
  expect(contents(steps)).toStrictEqual(["---\ndescription: D\noverrides: overview\n---\nB\n"]);
  expect(notes(steps)).toStrictEqual(["rewrote .repo/rules/overview.md frontmatter (root dropped)"]);
});

it("marks an old-format subagent that bears a stock name and keeps its targets", () => {
  const { steps } = plan({
    ".repo/subagents/scout.md": "---\nname: scout\ntargets:\n  - claudecode\n---\nBody\n",
    ".repo/subagents/mine.md": "---\nname: mine\ntargets:\n  - claudecode\n---\nBody\n",
  });
  expect(steps).toStrictEqual([
    {
      kind: "write",
      path: ".repo/subagents/scout.md",
      content: "---\noverrides: scout\nname: scout\ntargets:\n  - claudecode\n---\nBody\n",
      note: "marked .repo/subagents/scout.md with overrides: scout (it replaces the stock subagent)",
    },
  ]);
});

it("drops root and globs from a subagent", () => {
  const { steps } = plan({ ".repo/subagents/mine.md": "---\nname: mine\nroot: false\nglobs: [a]\n---\nBody\n" });
  expect(contents(steps)).toStrictEqual(["---\nname: mine\n---\nBody\n"]);
});

it("keeps CRLF line endings when it rewrites", () => {
  const { steps } = plan({ ".repo/rules/crlf.md": "---\r\nroot: false\r\ndescription: D\r\n---\r\nBody\r\n" });
  expect(contents(steps)).toStrictEqual(["---\r\ndescription: D\r\n---\r\nBody\r\n"]);
});

it("skips a file whose frontmatter does not parse, for the loader to report", () => {
  expect(plan({ ".repo/rules/a.md": "no fence\n", ".repo/rules/b.md": "---\nroot: [\n---\n" }).steps).toStrictEqual([]);
});

it("plans nothing without .repo, and rewrites without a stock package", () => {
  const { root } = upgradeRoot({});
  expect(planRuleUpgrade(root, path.join(root, "missing"))).toStrictEqual([]);
  write(root, ".repo/rules/a.md", "---\nroot: false\n---\nBody\n");
  expect(contents(planRuleUpgrade(root, path.join(root, "missing")))).toStrictEqual([
    "---\ndescription: a\n---\nBody\n",
  ]);
});

it("plans nothing on a second run", async () => {
  const { root, stock, steps } = plan({
    ".repo/rules/overview.md": "---\nroot: true\nglobs: ['**/*']\n---\n# Mine\n",
    ".repo/rules/testing.md": "---\nroot: false\nglobs: [src/**]\n---\nBody\n",
    ".repo/subagents/scout.md": "---\nname: scout\ntargets: [claudecode]\n---\nBody\n",
  });
  expect(steps).toHaveLength(3);
  const lines = await applyMigration(root, steps);
  expect(lines).toHaveLength(4);
  expect(lines.every((line) => line.startsWith("repo sync: "))).toBe(true);
  expect(planRuleUpgrade(root, stock)).toStrictEqual([]);
});
