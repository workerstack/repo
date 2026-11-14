import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { usePushRepos, type PushRepo } from "./__fixtures__/push-repo.ts";
import { pushedRefs } from "./ci-push-parse.ts";
import { spawnRunner } from "./ci-wait-run.ts";

const host = { git: spawnRunner("git"), p: path };
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
    const refs = pushedRefs(host, "bun repo push", r.dir);
    expect(refs).toStrictEqual(noted(r, "feat-a"));
  });

  it.each(["bun repo push feat-a", "repo push feat-a", "bun repo lint && bun repo push feat-a"])(
    "notes the branch %s names",
    (command) => {
      const r = onMain(["feat-b", "feat-a"]);
      expect(pushedRefs(host, command, r.dir)).toStrictEqual(noted(r, "feat-a"));
    },
  );

  it("resolves the branch in the directory a cd names", () => {
    const r = onMain(["feat-b", "feat-a"], "x");
    const refs = pushedRefs(host, "cd x && bun repo push feat-a", path.dirname(r.dir));
    expect(refs).toStrictEqual(noted(r, "feat-a"));
  });

  it("notes nothing when repo push would ask or send a worktree to finish", () => {
    const asks = onMain(["feat-b", "feat-a"]);
    expect(pushedRefs(host, "bun repo push", asks.dir)).toStrictEqual([]);
    const wt = onMain([]);
    wt.commitOn("wt/124-x", 0);
    expect(pushedRefs(host, "bun repo push", wt.dir)).toStrictEqual([]);
  });
});

describe("pushedRefs on the shared bash walk", () => {
  it.each([
    "(git push origin main)",
    "{ git push origin main; }",
    "x=$(git push origin main)",
    "if true; then git push origin main; fi",
    "bash x.sh",
    "bash missing.sh",
    "git push origin $B",
  ])("notes main for %s", (command) => {
    const r = onMain([]);
    fs.writeFileSync(path.join(r.dir, "x.sh"), "git push origin main\n");
    expect(pushedRefs(host, command, r.dir)).toStrictEqual(noted(r, "main"));
  });

  it("resolves a push in the dir env -C names, and notes nothing for a dir it cannot read", () => {
    const r = onMain(["feat-a"], "x");
    const parent = path.dirname(r.dir);
    expect(pushedRefs(host, "env -C x git push origin feat-a", parent)).toStrictEqual(noted(r, "feat-a"));
    expect(pushedRefs(host, 'env -C "$D" git push origin feat-a', parent)).toStrictEqual([]);
    expect(pushedRefs(host, "echo git push", r.dir)).toStrictEqual([]);
  });

  const noPush = ['cd "$D" && bash missing.sh', 'cd "$D" && bun repo push feat-a', "for w in git push; do :; done"];

  it.each(noPush)("notes nothing for %s, which runs no push in a dir it knows", (command) => {
    const r = onMain(["feat-a"]);
    expect(pushedRefs(host, command, r.dir)).toStrictEqual([]);
  });
});
