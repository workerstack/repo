import { afterEach, describe, expect, it } from "vitest";

import { ghFor, runGate, tagRelease } from "../__fixtures__/gate-world.ts";
import { removePlanted } from "../__fixtures__/planted-repo.ts";
import { commit, gitIn, NAME, world } from "../__fixtures__/release-world.ts";
import { DISPATCH_GRACE_MS, MS_PER_SECOND } from "../scripts/ci-wait.constants.ts";

afterEach(removePlanted);

const GRACE = `${DISPATCH_GRACE_MS / MS_PER_SECOND}s`;
const LIST = "databaseId,status,conclusion,event,headBranch,createdAt";

describe("repo release gate passes", () => {
  it("prints one line: the tag, version, changelog and the ci run it waited for", async () => {
    const w = world({}, false);
    const short = tagRelease(w, { version: "0.2.0" });
    expect(await runGate(w, [`${NAME}@0.2.0`])).toStrictEqual({
      code: 0,
      err: "",
      out:
        `repo release gate: ${NAME}@0.2.0 is ${short}, version 0.2.0, changelog ok · ` +
        `waiting for ci on ${short} (run 7)… · passed\n`,
    });
  });

  it("waits on the tagged commit even when the checkout is on a later one", async () => {
    const w = world({}, false);
    tagRelease(w, { version: "0.2.0" });
    const sha = gitIn(w.work, "rev-parse", "HEAD");
    commit(w, "chore: later", { "later.txt": "x\n" });
    const calls: string[] = [];
    const got = await runGate(w, [`${NAME}@0.2.0`], ghFor("main", {}, calls));
    expect(got.code).toBe(0);
    expect(calls).toContain(`run list --commit ${sha} --workflow ci.yml --json ${LIST}`);
  });
});

function setup() {
  const w = world({}, false);

  return { short: tagRelease(w, { version: "0.2.0" }), w };
}

describe("repo release gate on a ci that did not pass", () => {
  it("prints the failed jobs and tells you to release the next version", async () => {
    const { w, short } = setup();
    const got = await runGate(w, [`${NAME}@0.2.0`], ghFor("main", { conclusion: "failure" }));
    expect(got.code).toBe(1);
    expect(got.out).toContain("failed: test; logs below\nboom\n");
    expect(got.err).toBe(
      `repo release gate: CI failed on ${short}; a tag is never moved, ` +
        "so fix it in a new commit and release the next version\n",
    );
  });

  it("says a newer push cancelled it", async () => {
    const { w, short } = setup();
    const got = await runGate(w, [`${NAME}@0.2.0`], ghFor("main", { conclusion: "cancelled" }));
    expect(got.err).toBe(
      `repo release gate: a newer push cancelled CI on ${short}; rerun ci on it, then rerun this job\n`,
    );
  });

  it("says there was no run", async () => {
    const { w, short } = setup();
    const got = await runGate(w, [`${NAME}@0.2.0`], ghFor("main", { run: false }));
    expect(got.err).toBe(
      `repo release gate: no CI result for ${short} (no ci run after 120s); rerun this job once ci has run\n`,
    );
  });
});

describe("repo release gate on a branch ci does not run on", () => {
  it("says no CI will run when no run exists and origin names no default branch", async () => {
    const w = world({}, false);
    const short = tagRelease(w, { version: "0.2.0" });
    gitIn(w.work, "remote", "set-head", "origin", "-d");
    const got = await runGate(w, [`${NAME}@0.2.0`], ghFor("main", { run: false }));
    expect(got.err).toBe(
      `repo release gate: no CI will run for ${short} (nothing to wait on: ci runs on pushes to the default branch, ` +
        `on pull requests and on gh workflow run, and main has no pull request and no run after ${GRACE}); ` +
        "release from a branch ci runs on\n",
    );
  });
});
