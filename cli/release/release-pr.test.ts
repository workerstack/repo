import fs from "node:fs";
import path from "node:path";

import { afterEach, expect, it } from "vitest";

import { removePlanted } from "../__fixtures__/planted-repo.ts";
import { NAME, commit, gitIn, release, type World } from "../__fixtures__/release-world.ts";
import {
  PR_BASE,
  SUBJECT,
  TAG,
  prGh,
  prWorld,
  pushOnOrigin,
  releaseBranches,
  squashMerge,
  type PrGh,
} from "./__fixtures__/release-pr.ts";

afterEach(removePlanted);

const AGAIN = "run bun repo release again once it merges";
const DONE = `${NAME} 0.1.1 · already committed · CI passed · tagged ${TAG}\n`;

const OPENED = `repo release: opened ${PR_BASE}9 for ${TAG}; ${AGAIN}\n`;

function rev(w: World, ref: string) {
  return gitIn(w.work, "rev-parse", ref);
}

function remote(w: World, ref: string) {
  return gitIn(w.remote, "rev-parse", ref);
}

function prCalls(fake: PrGh) {
  return fake.calls.filter((c) => c[0] === "pr");
}

/** The release branch a run from HEAD names. */
function branchAtHead(w: World) {
  return `wt/release-0.1.1-${gitIn(w.work, "rev-parse", "--short=7", "HEAD")}`;
}

/** A world whose first run opened the release pull request: the world, the fake gh, the branch and the first run. */
async function opened() {
  const w = prWorld();
  const fake = prGh(w);
  const got = await release(w, [], fake.gh);
  const [branch = ""] = releaseBranches(w);

  return { branch, fake, got, w };
}

/** A world whose release pull request was squash-merged on origin: also the merge's sha. */
async function merged() {
  const o = await opened();

  return { ...o, merge: squashMerge(o.w, o.fake, o.branch) };
}

it("opens a pull request from wt/release-<version>-<short HEAD>, leaving main and origin/main", async () => {
  const w = prWorld();
  const [head, origin] = [rev(w, "HEAD"), remote(w, "main")];
  const fake = prGh(w);
  const got = await release(w, [], fake.gh);
  const branch = branchAtHead(w);
  expect(got).toStrictEqual({ code: 0, err: "", out: OPENED });
  expect(releaseBranches(w)).toStrictEqual([branch]);
  expect(gitIn(w.remote, "log", "-1", "--format=%s", branch)).toBe(SUBJECT);
  const after = [rev(w, "HEAD"), remote(w, "main"), gitIn(w.remote, "tag", "-l")];
  expect(after).toStrictEqual([head, origin, `${NAME}@0.1.0`]);
});

it("exits 1 with the not-merged line while the pull request is open", async () => {
  const { w, fake } = await opened();
  const got = await release(w, [], fake.gh);
  const err = `repo release: ${PR_BASE}9 for ${TAG} is not merged yet; ${AGAIN}\n`;
  expect(got).toStrictEqual({ code: 1, err, out: "" });
});

it("lands a squash merge, waits on CI and tags the merged commit", async () => {
  const { w, fake, merge } = await merged();
  const got = await release(w, [], fake.gh);
  expect(got).toStrictEqual({ code: 0, err: "", out: DONE });
  expect(fake.calls.some((c) => c.join(" ").startsWith("run list --commit"))).toBe(true);
  expect([rev(w, "HEAD"), remote(w, `${TAG}^{commit}`), releaseBranches(w)]).toStrictEqual([merge, merge, []]);
});

it("finds a release branch whose worktree is gone", async () => {
  const { w, fake, branch, merge } = await merged();
  const dir = path.join(w.work, ".worktrees", branch.slice("wt/".length));
  gitIn(w.work, "worktree", "remove", "--force", dir);
  expect(await release(w, [], fake.gh)).toMatchObject({ code: 0, out: DONE });
  expect(remote(w, `${TAG}^{commit}`)).toBe(merge);
});

it("leaves the tag on the release commit when a later merge sits above it", async () => {
  const { w, fake, merge } = await merged();
  const later = pushOnOrigin(w, gitIn(w.remote, "rev-parse", "main^{tree}"), "docs: later (#10)");
  expect(await release(w, [], fake.gh)).toMatchObject({ code: 0, out: DONE });
  expect([rev(w, "HEAD"), remote(w, `${TAG}^{commit}`)]).toStrictEqual([later, merge]);
});

it("refuses a closed pull request with finish's text", async () => {
  const { w, fake, branch } = await opened();
  (fake.prs.get(branch) ?? { state: "" }).state = "CLOSED";
  const got = await release(w, [], fake.gh);
  const url = `${PR_BASE}9`;
  const why = `the pull request for ${branch} was closed without merging (${url}): reopen it with gh pr reopen 9`;
  expect(got).toStrictEqual({ code: 1, err: `repo release: ${why}, then run finish again\n`, out: "" });
});

it("opens the pull request a run that stopped before gh pr create left unopened", async () => {
  const w = prWorld();
  const fake = prGh(w);
  fake.fail = { code: 1, stderr: "boom\n", stdout: "" };
  const first = await release(w, [], fake.gh);
  expect(first.err).toMatch(/^repo release: could not open a pull request for wt\/release-0\.1\.1-\w+: boom; /);
  delete fake.fail;
  expect(await release(w, [], fake.gh)).toMatchObject({ code: 0, out: OPENED });
});

it("goes on to release when the branch has nothing to finish", async () => {
  const w = prWorld();
  const dir = path.join(w.work, ".worktrees", "release-0.1.1-0000000");
  gitIn(w.work, "worktree", "add", "-q", "-b", "wt/release-0.1.1-0000000", dir);
  expect(await release(w, [], prGh(w).gh)).toMatchObject({ code: 0, out: OPENED });
  expect(releaseBranches(w)).toStrictEqual([branchAtHead(w)]);
});

it("folds a fix into an untagged merged release through a second pull request under a new name", async () => {
  const { w, fake, branch } = await merged();
  fake.ci.conclusion = "failure";
  const red = await release(w, [], fake.gh);
  expect(red.code).toBe(1);
  const stamped = fs.readFileSync(path.join(w.work, "CHANGELOG.md"), "utf8");
  const fixed = stamped.replace(/## \[Unreleased\]\r?\n/u, "## [Unreleased]\n\n### Fixed\n\n- y\n");
  commit(w, "fix: y", { "CHANGELOG.md": fixed });
  const got = await release(w, [], fake.gh);
  expect(got).toStrictEqual({ code: 0, err: "", out: `repo release: opened ${PR_BASE}10 for ${TAG}; ${AGAIN}\n` });
  expect(releaseBranches(w)).toHaveLength(1);
  expect(releaseBranches(w)).not.toContain(branch);
});

it("refuses a main ahead of origin before finish runs", async () => {
  const { w, fake } = await opened();
  commit(w, "fix: local", { "src/y.ts": "export const y = 1;\n" }, false);
  const calls = prCalls(fake).length;

  const why =
    "main has 1 commit origin lacks; under the pull-request workflow it reaches main only through a pull request";

  const got = await release(w, [], fake.gh);
  expect(got).toStrictEqual({ code: 1, err: `repo release: ${why}\n`, out: "" });
  expect(prCalls(fake)).toHaveLength(calls);
});

it("counts commits in the plural", async () => {
  const w = prWorld();
  commit(w, "fix: a", { "src/a.ts": "export const a = 1;\n" }, false);
  commit(w, "fix: b", { "src/b.ts": "export const b = 1;\n" }, false);
  const got = await release(w, [], prGh(w).gh);
  expect(got.err).toMatch(/^repo release: main has 2 commits origin lacks;/);
});

it("refuses two release branches under the pull-request workflow", async () => {
  const w = prWorld();
  gitIn(w.work, "branch", "wt/release-a");
  gitIn(w.work, "branch", "wt/release-b");

  const why =
    "more than one release branch (wt/release-a, wt/release-b); " +
    "finish or remove all but one, then run bun repo release again";

  expect(await release(w, [], prGh(w).gh)).toStrictEqual({ code: 1, err: `repo release: ${why}\n`, out: "" });
});

it("refuses what the plan refuses", async () => {
  const w = prWorld();
  fs.writeFileSync(path.join(w.work, "x.txt"), "dirty\n");
  const got = await release(w, [], prGh(w).gh);
  expect(got.err).toBe("repo release: the working tree has changes; commit or stash them first\n");
});

it("keeps pushing main under the worktree workflow", async () => {
  const w = prWorld("worktree");
  const got = await release(w, [], prGh(w).gh);
  expect(got.out).toBe(`${NAME} 0.1.0 → 0.1.1 · committed · pushed · CI passed · tagged ${TAG}\n`);
  expect([remote(w, "main"), releaseBranches(w)]).toStrictEqual([rev(w, "HEAD"), []]);
});
