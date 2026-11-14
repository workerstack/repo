import { describe, expect, it } from "vitest";

import { FORCE, pushDeny, sharedAs, STRICT, useGuardRepos } from "./__fixtures__/workflow-guards.ts";
import { at, wt } from "./__fixtures__/worktree-repo.ts";

const { repoWithWorktree } = useGuardRepos();

describe("delete pushes of main", () => {
  const deletes = [
    "git push origin :main",
    "git push origin +:main",
    "git push origin :refs/heads/main",
    "git push origin --delete main",
    "git push --delete origin refs/heads/main",
    "git push -d origin main",
    "git push origin wt/x :main",
  ];

  it.each(STRICT)("denies each delete form of main from the root and a worktree under %s", (read) => {
    const r = repoWithWorktree();

    for (const cmd of deletes) {
      expect(sharedAs(read, { cmd, place: at(r) }), cmd).toBe(pushDeny(read));
      expect(sharedAs(read, { asked: FORCE, cmd, place: at(r, wt(r, "a")) }), cmd).toBe(pushDeny(read));
    }
  });

  it("lets delete pushes of main through under worktree and main, and of other branches under pull-request", () => {
    const place = at(repoWithWorktree());

    for (const read of ["worktree", "main"] as const)
      for (const cmd of deletes.filter((c) => !c.includes("+"))) expect(sharedAs(read, { cmd, place }), cmd).toBeNull();

    for (const cmd of ["git push origin :wt/x", "git push origin --delete wt/x", "git push -d origin mainline"])
      expect(sharedAs("pull-request", { cmd, place }), cmd).toBeNull();
  });
});
