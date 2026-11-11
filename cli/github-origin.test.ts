import fs from "node:fs";

import { afterEach, describe, expect, it } from "vitest";

import { GITHUB_TEMPS, githubRepo } from "./__fixtures__/github-repo.ts";
import { originSlug, parseSlug } from "./github-origin.ts";

afterEach(() => {
  for (const dir of GITHUB_TEMPS.splice(0)) fs.rmSync(dir, { force: true, recursive: true });
});

describe("parseSlug", () => {
  it.each([
    "https://github.com/workerstack/repo",
    "https://github.com/workerstack/repo.git",
    "https://github.com/workerstack/repo/",
    "https://token@github.com/workerstack/repo.git",
    "git@github.com:workerstack/repo.git",
    "ssh://git@github.com/workerstack/repo.git",
    "  https://github.com/workerstack/repo.git\n",
  ])("reads %j", (url) => {
    expect(parseSlug(url)).toBe("workerstack/repo");
  });

  it.each(["https://gitlab.com/a/b.git", "git@gitlab.com:a/b.git", "https://github.com/a", "../local", ""])(
    "refuses %j",
    (url) => {
      expect(parseSlug(url)).toBeNull();
    },
  );
});

describe("originSlug", () => {
  it("reads the checkout's origin", () => {
    expect(originSlug(githubRepo({ origin: "git@github.com:o/r.git" }))).toBe("o/r");
  });

  it("is null without an origin and with one that is not on GitHub", () => {
    expect(originSlug(githubRepo({ origin: null }))).toBeNull();
    expect(originSlug(githubRepo({ origin: "https://example.com/o/r.git" }))).toBeNull();
  });
});
