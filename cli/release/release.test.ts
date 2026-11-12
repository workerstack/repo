import fs from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { removePlanted } from "../__fixtures__/planted-repo.ts";
import { NAME, commit, fakeGh, feat, gitIn, release, snapshot, world } from "../__fixtures__/release-world.ts";
import type { World } from "../__fixtures__/release-world.ts";
import { ciLine } from "./release.ts";

afterEach(removePlanted);

const TAG = `${NAME}@0.1.1`;
const SUBJECT = `chore: release ${TAG}`;
const AGAIN = "run bun repo release again";

const STAMPED =
  "# Changelog\n\n## [Unreleased]\n\n## [0.1.1] - 2026-11-09\n\n### Added\n\n- x\n\n" +
  "## [0.1.0] - 2026-10-01\n\n### Added\n\n- first\n";

const FIXED =
  "# Changelog\n\n## [Unreleased]\n\n## [0.1.1] - 2026-11-09\n\n### Added\n\n- x\n\n### Fixed\n\n- y\n\n" +
  "## [0.1.0] - 2026-10-01\n\n### Added\n\n- first\n";

function text(w: World, file: string) {
  return fs.readFileSync(path.join(w.work, file), "utf8");
}

function head(w: World) {
  return gitIn(w.work, "rev-parse", "HEAD");
}

function hookFile(w: World, name: string) {
  return path.join(w.work, ".git", "hooks", name);
}

/** Makes the checkout's next run of the git hook `name` refuse (for pre-push: only a push of tags). */
function refuse(w: World, name: string, only = "") {
  return fs.writeFileSync(hookFile(w, name), `#!/bin/sh\n${only}echo no >&2\nexit 1\n`, { mode: 0o755 });
}

/** A world with one feat commit waiting to be released. */
function fed() {
  const w = world();
  feat(w);

  return w;
}

/** A world with a feat released: the output of the first run and whether the tag was out when CI was watched. */
async function released() {
  const w = fed();
  const seen: { tags: string; pushed: string }[] = [];

  function onWatch() {
    return seen.push({ pushed: gitIn(w.remote, "log", "-1", "--format=%s"), tags: gitIn(w.remote, "tag", "-l") });
  }

  return { got: await release(w, [], fakeGh({ onWatch })), seen, w };
}

describe("a release", () => {
  it("prints the summary line and exits 0", async () => {
    const { got } = await released();
    const line = `${NAME} 0.1.0 → 0.1.1 · committed · pushed · CI passed · tagged ${TAG}\n`;
    expect(got).toStrictEqual({ code: 0, err: "", out: line });
  });

  it("commits only the version line and the stamped changelog", async () => {
    const { w } = await released();
    expect(gitIn(w.work, "log", "-1", "--format=%s")).toBe(SUBJECT);
    const files = gitIn(w.work, "show", "--format=", "--name-only", "HEAD").split("\n");
    expect(files.toSorted()).toStrictEqual(["CHANGELOG.md", "package.json"]);
    expect(gitIn(w.work, "show", "--format=", "--numstat", "HEAD", "--", "package.json")).toBe("1\t1\tpackage.json");
    expect(text(w, "CHANGELOG.md")).toBe(STAMPED);
  });

  it("pushes the commit and then tags it, the tag annotated and pushed after CI passed", async () => {
    const { w, seen } = await released();
    expect(seen).toStrictEqual([{ pushed: SUBJECT, tags: `${NAME}@0.1.0` }]);
    expect(gitIn(w.work, "cat-file", "-t", `refs/tags/${TAG}`)).toBe("tag");
    expect(gitIn(w.work, "rev-parse", `${TAG}^{commit}`)).toBe(head(w));
    expect(gitIn(w.remote, "rev-parse", `${TAG}^{commit}`)).toBe(head(w));
    expect(gitIn(w.remote, "rev-parse", "main")).toBe(head(w));
  });
});

describe("a release of another kind", () => {
  it("releases 0.1.0 from 0.0.0 with no tag", async () => {
    const w = world({ "package.json": { name: NAME, version: "0.0.0" } }, false);
    commit(w, "feat: add x", { "CHANGELOG.md": "# Changelog\n\n## [Unreleased]\n\n### Added\n\n- x\n" });
    const got = await release(w, []);
    expect(got.out).toBe(`${NAME} 0.0.0 → 0.1.0 · committed · pushed · CI passed · tagged ${NAME}@0.1.0\n`);
  });

  it("takes main when origin names no default branch", async () => {
    const w = fed();
    gitIn(w.work, "remote", "set-head", "origin", "-d");
    const got = await release(w, []);
    expect(got.code).toBe(0);
  });

  it("moves 0.x to 1.0.0 with --stable", async () => {
    const w = fed();
    const got = await release(w, ["--stable"]);
    expect(got.out).toContain("0.1.0 → 1.0.0 ·");
  });

  it("starts a prerelease with --pre", async () => {
    const w = fed();
    const got = await release(w, ["--pre", "rc"]);
    expect(got.out).toContain("0.1.0 → 0.1.1-rc.0 ·");
    expect(gitIn(w.work, "tag", "-l")).toContain(`${NAME}@0.1.1-rc.0`);
  });
});

async function failing(behavior: Parameters<typeof fakeGh>[0]) {
  const w = fed();
  const got = await release(w, [], fakeGh(behavior));

  return { got, short: gitIn(w.work, "rev-parse", "--short=7", "HEAD"), w };
}

describe("a release CI does not pass", () => {
  it("prints the jobs and the failed line, pushes, and leaves no tag", async () => {
    const { w, got, short } = await failing({ conclusion: "failure" });
    expect(got.out).toContain("failed: test; logs below\nboom\n");
    const line = `CI failed on ${short} (jobs above); fix it in a new commit, push, and ${AGAIN}`;
    expect(got).toMatchObject({ code: 1, err: `repo release: ${line}\n` });
    expect(snapshot(w)).toMatchObject({ remoteTags: `${NAME}@0.1.0`, tags: `${NAME}@0.1.0` });
    expect(gitIn(w.remote, "log", "-1", "--format=%s")).toBe(SUBJECT);
  });

  it("says a newer push cancelled the run", async () => {
    const { w, got, short } = await failing({ conclusion: "cancelled" });
    expect(got.err).toBe(`repo release: a newer push cancelled CI on ${short}; pull and ${AGAIN}\n`);
    expect(snapshot(w).remoteTags).toBe(`${NAME}@0.1.0`);
  });

  it("says there was no CI result when no run appears", async () => {
    const { w, got, short } = await failing({ run: false });
    const line = `no CI result for ${short} (no ci run after 120s); it is pushed and untagged; ${AGAIN}`;
    expect(got).toMatchObject({ code: 1, err: `repo release: ${line}\n`, out: "" });
    expect(snapshot(w).tags).toBe(`${NAME}@0.1.0`);
  });
});

/** A world whose release commit is pushed and untagged because CI was red. */
async function pendingAfterRed() {
  const w = fed();
  await release(w, [], fakeGh({ conclusion: "failure" }));

  return w;
}

describe("a rerun after red CI", () => {
  it("on the release commit adds no commit and tags it", async () => {
    const w = await pendingAfterRed();
    const before = head(w);
    const got = await release(w, []);
    const out = `${NAME} 0.1.1 · already committed · CI passed · tagged ${TAG}\n`;
    expect(got).toStrictEqual({ code: 0, err: "", out });
    expect(head(w)).toBe(before);
    expect(gitIn(w.remote, "rev-parse", `${TAG}^{commit}`)).toBe(before);
  });

  it("after a fix commit folds its entry into the version and tags HEAD", async () => {
    const w = await pendingAfterRed();
    commit(w, "fix: y", {
      "CHANGELOG.md": STAMPED.replace("## [Unreleased]\n", "## [Unreleased]\n\n### Fixed\n\n- y\n"),
    });
    const got = await release(w, []);
    expect(got.out).toBe(`${NAME} 0.1.1 · committed · pushed · CI passed · tagged ${TAG}\n`);
    expect(gitIn(w.work, "log", "-1", "--format=%s")).toBe(SUBJECT);
    expect(text(w, "CHANGELOG.md")).toBe(FIXED);
    expect(gitIn(w.remote, "rev-parse", `${TAG}^{commit}`)).toBe(head(w));
  });

  it("after a fix commit with nothing under Unreleased makes no commit and tags HEAD", async () => {
    const w = await pendingAfterRed();
    commit(w, "fix: y", { "src/y.ts": "export const y = 2;\n" });
    const before = head(w);
    const got = await release(w, []);
    expect(got.out).toBe(`${NAME} 0.1.1 · already committed · CI passed · tagged ${TAG}\n`);
    expect(gitIn(w.remote, "rev-parse", `${TAG}^{commit}`)).toBe(before);
  });
});

/** A world whose release commit a refusing pre-push hook (`only`: the body before it) keeps from leaving. */
async function refusedPush(only?: string) {
  const w = fed();
  refuse(w, "pre-push", only);
  const refused = await release(w, []);
  expect(refused.err).toMatch(/^repo release: git push failed: .*no/s);

  return w;
}

describe("a rerun after a push that failed", () => {
  it("pushes the release commit that never left, then tags it", async () => {
    const w = await refusedPush();
    expect(gitIn(w.work, "log", "-1", "--format=%s")).toBe(SUBJECT);
    fs.rmSync(hookFile(w, "pre-push"));
    const got = await release(w, []);
    expect(got.out).toBe(`${NAME} 0.1.1 · already committed · pushed · CI passed · tagged ${TAG}\n`);
    expect(gitIn(w.remote, "rev-parse", "main")).toBe(head(w));
  });

  it("deletes a local tag that did not reach origin, so a rerun makes it", async () => {
    const w = await refusedPush("grep -q refs/tags || exit 0\n");
    expect(gitIn(w.work, "tag", "-l")).toBe(`${NAME}@0.1.0`);
    fs.rmSync(hookFile(w, "pre-push"));
    const got = await release(w, []);
    expect(got.out).toBe(`${NAME} 0.1.1 · already committed · CI passed · tagged ${TAG}\n`);
  });
});

describe("a release whose commit git refuses", () => {
  it("prints the hook output, then one closing line, and restores the files", async () => {
    const w = fed();
    refuse(w, "commit-msg");
    const before = snapshot(w);
    const got = await release(w, []);
    expect(got).toMatchObject({ code: 1, out: "" });

    const last =
      "repo release: the hooks refused the release commit (output above); " +
      "nothing was changed, so fix it and run bun repo release again\n";

    expect(got.err).toMatch(/^no\n/);
    expect(got.err.endsWith(`\n${last}`)).toBe(true);
    expect(snapshot(w)).toStrictEqual(before);
    expect(snapshot(w).status).toBe("");
  });
});

describe("the line for a branch ci does not run on", () => {
  it("says no CI will run for a branch ci does not run on, with the reason", () => {
    const why = "nothing to wait on: ci runs on pushes to main and on pull requests, and x has neither";
    expect(ciLine({ kind: "nothing", line: why }, "abc1234")).toBe(
      `${why}; abc1234 is pushed and untagged; open a pull request or release from the default branch`,
    );
  });
});
