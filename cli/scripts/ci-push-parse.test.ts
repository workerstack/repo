import path from "node:path";

import { describe, expect, it } from "vitest";

import { usePushRepos, type PushRepo } from "./__fixtures__/push-repo.ts";
import { pushedRefs } from "./ci-push-parse.ts";
import { spawnRunner } from "./ci-wait-run.ts";

const git = spawnRunner("git");
const { repo } = usePushRepos();

/** A repo on main, made in the folder `x`, with feat-b (2 days old) and feat-a (1 day old), or feat-a alone. */
function onMain(branches: string[], sub?: string): PushRepo {
  const r = repo({ now: Date.now(), sub });

  for (const [i, branch] of branches.entries()) r.commitOn(branch, branches.length - i);
  r.git(["checkout", "-q", "main"]);

  return r;
}

/** The one ref a push of `branch` from `dir` notes. */
function noted(r: PushRepo, branch: string, dir = r.dir): unknown[] {
  return [expect.objectContaining({ branch, dir, sha: r.git(["rev-parse", branch]) }) as unknown];
}

describe("pushedRefs and repo push", () => {
  it("notes the branch bun repo push picks", () => {
    const r = onMain(["feat-a"]);
    const refs = pushedRefs(git, "bun repo push", r.dir);
    expect(refs).toStrictEqual(noted(r, "feat-a"));
  });

  it.each(["bun repo push feat-a", "repo push feat-a", "bun repo lint && bun repo push feat-a"])(
    "notes the branch %s names",
    (command) => {
      const r = onMain(["feat-b", "feat-a"]);
      expect(pushedRefs(git, command, r.dir)).toStrictEqual(noted(r, "feat-a"));
    },
  );

  it("resolves the branch in the directory a cd names", () => {
    const r = onMain(["feat-b", "feat-a"], "x");
    const refs = pushedRefs(git, "cd x && bun repo push feat-a", path.dirname(r.dir));
    expect(refs).toStrictEqual(noted(r, "feat-a"));
  });

  it("notes nothing when repo push would ask or send a worktree to finish", () => {
    const asks = onMain(["feat-b", "feat-a"]);
    expect(pushedRefs(git, "bun repo push", asks.dir)).toStrictEqual([]);
    const wt = onMain([]);
    wt.commitOn("wt/124-x", 0);
    expect(pushedRefs(git, "bun repo push", wt.dir)).toStrictEqual([]);
  });
});
