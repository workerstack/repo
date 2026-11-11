import { describe, expect, it } from "vitest";

import { useGitTree } from "./__fixtures__/git-tree.ts";
import { checkFixtures } from "./check-fixtures.ts";

const { plant, repoWith, untrackedRepo } = useGitTree("check-fixtures-");

const NAMES = ["fixtures", "fixture", "__fixture__", "test-fixtures", "test_fixtures", "testdata"];

describe("checkFixtures", () => {
  it.each(NAMES)("fails a folder named %s with the rename hint", (name) => {
    const dir = repoWith({ [`pkg/${name}/x.json`]: "{}\n" });
    expect(checkFixtures(dir)).toStrictEqual([
      `fixtures: pkg/${name} is a fixture folder; rename it to pkg/__fixtures__ (bun repo fixtures --fix)`,
    ]);
  });

  it("reports one line per folder, not per file", () => {
    const dir = repoWith({ "a/fixtures/x.json": "{}\n", "a/fixtures/y.json": "{}\n", "b/testdata/z.txt": "z\n" });
    expect(checkFixtures(dir)).toHaveLength(2);
  });

  it("counts an untracked folder that is not ignored", () => {
    const dir = untrackedRepo({ "pkg/fixtures/x.json": "{}\n" });
    expect(checkFixtures(dir)).toHaveLength(1);
  });

  it("skips a gitignored folder", () => {
    const dir = repoWith({ ".gitignore": "pkg/fixtures/\n", "pkg/fixtures/x.json": "{}\n" });
    expect(checkFixtures(dir)).toStrictEqual([]);
  });
});

describe("checkFixtures, passing layouts", () => {
  it("passes __fixtures__", () => {
    expect(checkFixtures(repoWith({ "pkg/__fixtures__/x.json": "{}\n" }))).toStrictEqual([]);
  });

  it("passes a fixtures folder under __fixtures__", () => {
    expect(checkFixtures(repoWith({ "pkg/__fixtures__/fixtures/x.json": "{}\n" }))).toStrictEqual([]);
  });

  it.each(["vendor", "node_modules"])("passes a fixtures folder under %s", (skipped) => {
    expect(checkFixtures(repoWith({ [`${skipped}/x/test/fixtures/a.json`]: "{}\n" }))).toStrictEqual([]);
  });

  it("is empty outside a git repo", () => {
    expect(checkFixtures(plant({ "fixtures/x.json": "{}\n" }))).toStrictEqual([]);
  });
});
