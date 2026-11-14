import { describe, expect, it } from "vitest";

import type { WorkflowRead } from "../workflow.ts";
import { pushDeny, sharedAs, STRICT, useGuardRepos } from "./__fixtures__/workflow-guards.ts";
import { at, wt } from "./__fixtures__/worktree-repo.ts";

const { repoWithWorktree } = useGuardRepos();

/** The deny text for a push word the gate cannot read, with default branch `main`. */
function unreadDeny(word: string, read: WorkflowRead): string {
  const why = read === "unreadable" ? "repo.config.ts failed to load" : `workflow is ${read}`;

  return (
    `git push names ${word}, which the gate cannot read before the shell runs, and main takes changes only through ` +
    `pull requests (${why}): name the branch, such as git push origin wt/<name>, or run bun repo worktree finish <name>`
  );
}

/** Pushes whose ref the shell sets only as it runs, each with the word the deny names. */
const UNREAD = [
  ["git push origin $B", "$B"],
  ["git push $R", "$R"],
  ['git push origin "HEAD:$B"', "HEAD:$B"],
  ['git push origin "$B"', "$B"],
  ["git push origin `echo main`", "`echo main`"],
] as const;

describe("pushes the gate cannot read", () => {
  it.each(STRICT)("denies a push with a word the shell sets under %s, naming the word and the fix", (read) => {
    const place = at(repoWithWorktree());

    for (const [cmd, word] of UNREAD) expect(sharedAs(read, { cmd, place }), cmd).toBe(unreadDeny(word, read));
  });

  it("lets the same pushes through under worktree and main", () => {
    const place = at(repoWithWorktree());

    for (const read of ["worktree", "main"] as const)
      for (const [cmd] of UNREAD) expect(sharedAs(read, { cmd, place }), `${read}: ${cmd}`).toBeNull();
  });
});

describe("pushes that spell the default branch another way", () => {
  it.each(STRICT)("denies @, heads/main and HEAD:heads/main from the branch they reach under %s", (read) => {
    const r = repoWithWorktree();
    const main = at(r);
    const inA = at(r, wt(r, "a"));

    for (const cmd of ["git push origin @", "git push origin heads/main", "git push origin refs/heads/main"])
      expect(sharedAs(read, { cmd, place: main }), cmd).toBe(pushDeny(read));

    for (const cmd of ["git push origin HEAD:heads/main", "git push origin @:main"])
      expect(sharedAs(read, { cmd, place: inA }), cmd).toBe(pushDeny(read));
  });

  it.each(STRICT)("lets @ and heads/wt/a through from worktree a under %s", (read) => {
    const r = repoWithWorktree();
    const inA = at(r, wt(r, "a"));

    const passing = [
      "git push origin @",
      "git push origin heads/wt/a",
      "git push origin v1",
      "git push origin HEAD:heads/wt/a",
    ];

    for (const cmd of passing) expect(sharedAs(read, { cmd, place: inA }), cmd).toBeNull();
  });
});
