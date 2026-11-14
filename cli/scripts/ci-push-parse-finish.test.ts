import fs from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { B, D, cleanRigs, noResult, rig } from "./__fixtures__/push-gate-rig.ts";
import { usePushRepos, type PushRepo } from "./__fixtures__/push-repo.ts";
import { pushedRefs } from "./ci-push-parse.ts";
import { spawnRunner } from "./ci-wait-run.ts";

afterEach(cleanRigs);

const git = spawnRunner("git");
const { repo } = usePushRepos();

/** `export default { workflow: <workflow> }` as `dir`'s repo.config.ts, or a config that throws as it loads. */
function configure(dir: string, workflow: string | null): void {
  const body = workflow === null ? 'throw new Error("broken");\n' : `export default { workflow: "${workflow}" };\n`;
  fs.writeFileSync(path.join(dir, "repo.config.ts"), body);
}

/** A repo on main under `workflow` with a managed worktree `a` on `wt/a` one commit ahead; the worktree's path. */
function withWorktree(workflow: string | null) {
  const r = repo({ now: Date.now() });
  configure(r.dir, workflow);
  const tree = path.join(r.dir, ".worktrees", "a");
  r.git(["worktree", "add", "-q", tree, "-b", "wt/a"]);
  fs.writeFileSync(path.join(tree, "a.txt"), "a\n");
  r.git(["-C", tree, "add", "a.txt"]);
  r.git(["-C", tree, "commit", "-q", "-m", "chore: a"]);

  return { r, tree };
}

/** The one ref a finish of `wt/a` notes: wt/a's tip, resolved in the main root. */
function finishOfA(r: PushRepo): unknown[] {
  const root = fs.realpathSync(r.dir);

  return [{ branch: "wt/a", dir: root, sha: r.git(["rev-parse", "wt/a"]), src: "wt/a" }];
}

describe("pushedRefs reads worktree finish as a push under pull-request", () => {
  it.each(["bun repo worktree finish a", "repo worktree finish a", "bun repo lint && bun repo worktree finish a"])(
    "notes wt/a for %s from the root",
    (command) => {
      const { r } = withWorktree("pull-request");
      expect(pushedRefs(git, command, r.dir)).toStrictEqual(finishOfA(r));
    },
  );

  it("takes the branch from the worktree a nameless finish runs in", () => {
    const { r, tree } = withWorktree("pull-request");
    expect(pushedRefs(git, "repo worktree finish", tree)).toStrictEqual(finishOfA(r));
    expect(pushedRefs(git, `cd '${tree}' && bun repo worktree finish`, r.dir)).toStrictEqual(finishOfA(r));
  });

  it("notes nothing for a nameless finish in the root on main, or a finish of a missing branch", () => {
    const { r } = withWorktree("pull-request");
    expect(pushedRefs(git, "bun repo worktree finish", r.dir)).toStrictEqual([]);
    expect(pushedRefs(git, "bun repo worktree finish nope", r.dir)).toStrictEqual([]);
  });

  it("notes nothing for other worktree verbs", () => {
    const { r } = withWorktree("pull-request");
    expect(pushedRefs(git, "bun repo worktree add a", r.dir)).toStrictEqual([]);
    expect(pushedRefs(git, "bun repo worktree", r.dir)).toStrictEqual([]);
  });
});

describe("pushedRefs reads worktree finish as nothing outside pull-request", () => {
  it.each(["worktree", "main", null])("notes nothing under %s", (workflow) => {
    const { r, tree } = withWorktree(workflow);
    expect(pushedRefs(git, "bun repo worktree finish a", r.dir)).toStrictEqual([]);
    expect(pushedRefs(git, "repo worktree finish", tree)).toStrictEqual([]);
  });

  it("reads the main root's repo.config.ts, never the worktree's own", () => {
    const { tree } = withWorktree("main");
    configure(tree, "pull-request");
    expect(pushedRefs(git, "repo worktree finish", tree)).toStrictEqual([]);
  });
});

describe("the push gate and a finish under pull-request", () => {
  it("waits on the tip finish rebased onto a moved default branch, not the tip before it", () => {
    const r = rig({ refs: { "wt/a": B } });
    configure(r.main, "pull-request");
    r.note("bun repo worktree finish a");
    expect(r.raw()).toStrictEqual([expect.objectContaining({ branch: "wt/a", pending: true, sha: B })]);
    r.world.refs["wt/a"] = D;
    r.world.landed["wt/a"] = [D];
    expect(r.gate()).toBe(noResult(D, "wt/a"));
  });

  it("notes no finish under the worktree workflow", () => {
    const r = rig({ refs: { "wt/a": B } });
    r.note("bun repo worktree finish a");
    expect(r.raw()).toStrictEqual([]);
  });
});
