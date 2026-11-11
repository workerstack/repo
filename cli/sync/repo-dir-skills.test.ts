import fs from "node:fs";
import path from "node:path";

import { expect, it } from "vitest";

import { check, repo, skill, sourcesOf } from "./__fixtures__/repo-dir-kit.ts";
import { useTempDirs } from "./__fixtures__/temp-dirs.ts";
import { repoDirProblems } from "./repo-dir.ts";

useTempDirs();

it("flags a skill folder without SKILL.md", () => {
  expect(check(repo({ ".repo/skills/deploy/notes.md": "x" }))).toStrictEqual([
    ".repo/skills/deploy: SKILL.md is missing; add it or delete the folder",
  ]);
});

it("flags a file straight under skills/", () => {
  expect(check(repo({ ".repo/skills/README.md": "x" }))).toStrictEqual([
    ".repo/skills/README.md: not a skill folder; skills are skills/<name>/SKILL.md",
  ]);
});

it("requires name to equal the folder name", () => {
  expect(check(repo({ ".repo/skills/deploy/SKILL.md": skill("ship") }))).toStrictEqual([
    '.repo/skills/deploy/SKILL.md: name "ship" must equal the folder name "deploy"',
  ]);
  expect(check(repo({ ".repo/skills/deploy/SKILL.md": "---\ndescription: d\n---\n" }))).toStrictEqual([
    '.repo/skills/deploy/SKILL.md: name is required; set it to the folder name "deploy"',
  ]);
});

it("requires a description of at most 1024 characters", () => {
  expect(check(repo({ ".repo/skills/deploy/SKILL.md": "---\nname: deploy\n---\n" }))).toStrictEqual([
    ".repo/skills/deploy/SKILL.md: description is required",
  ]);
  expect(check(repo({ ".repo/skills/deploy/SKILL.md": skill("deploy", "a".repeat(1025)) }))).toStrictEqual([
    ".repo/skills/deploy/SKILL.md: description is 1025 characters, over the 1024 limit; shorten it",
  ]);
  expect(check(repo({ ".repo/skills/deploy/SKILL.md": skill("deploy", "a".repeat(1024)) }))).toStrictEqual([]);
});

it("reports unreadable frontmatter once", () => {
  expect(check(repo({ ".repo/skills/deploy/SKILL.md": "plain\n" }))).toStrictEqual([
    ".repo/skills/deploy/SKILL.md: missing frontmatter (start the file with a --- block)",
  ]);
});

it("flags a dead link, resolved from the skill's folder", () => {
  const body = "See [steps](./steps.md#top) and [more](refs/more.md).\n";
  const root = repo({
    ".repo/skills/deploy/SKILL.md": skill("deploy", "d", body),
    ".repo/skills/deploy/refs/more.md": "x",
  });
  expect(check(root)).toStrictEqual([".repo/skills/deploy/SKILL.md: link ./steps.md does not exist"]);
  fs.writeFileSync(path.join(root, ".repo/skills/deploy/steps.md"), "x");
  expect(check(root)).toStrictEqual([]);
});

it("asks a skill named like a stock skill for overrides, unless its pack is off", () => {
  const root = repo({ ".repo/skills/ask/SKILL.md": skill("ask") });
  expect(check(root)).toStrictEqual([
    ".repo/skills/ask: a stock skill has this name; add `overrides: ask` to its SKILL.md or rename it",
  ]);
  const ok = repo({ ".repo/skills/ask/SKILL.md": `---\nname: ask\ndescription: d\noverrides: ask\n---\n` });
  expect(check(ok)).toStrictEqual([]);
  const bad = repo({ ".repo/skills/mine/SKILL.md": `---\nname: mine\ndescription: d\noverrides: nope\n---\n` });
  expect(check(bad)).toStrictEqual(['.repo/skills/mine/SKILL.md: overrides "nope" but no stock skill has that name']);
});

it("does not ask for overrides when the stock is this repo itself", () => {
  const root = repo({ ".repo/skills/ask/SKILL.md": skill("ask") });
  expect(
    repoDirProblems(root, { listed: null, packages: [], skills: [], sources: sourcesOf(), stock: root }),
  ).toStrictEqual([]);
});
