import path from "node:path";

import { describe, expect, it } from "vitest";

import { pushDeny, sharedAs, useGuardRepos } from "./__fixtures__/workflow-guards.ts";
import { at } from "./__fixtures__/worktree-repo.ts";
import { worktreeAddReason } from "./worktree-guards.ts";

const { repoWithWorktree } = useGuardRepos();

/** The start of a push deny the gate gives for a dir or word it cannot read. */
const UNREAD = /, which the gate cannot read before the shell runs, and main takes changes only through pull requests/;

/** `line` under pull-request from the root of a fresh repo, with `<out>` a dir outside it and `<root>` the root. */
function pushFromRoot(line: string): string | null {
  const r = repoWithWorktree();
  const cmd = line.replaceAll("<out>", `'${path.dirname(r)}'`).replaceAll("<root>", `'${r}'`);

  return sharedAs("pull-request", { cmd, place: at(r) });
}

/** Lines whose dir or ref the gate follows to a value it can read, and lets push. */
const followed = [
  "S=<out>; cd $S && git push origin main",
  'S=<out>; git -C "$S" push origin main',
  'export S=<out>; cd "$S" && git push origin main',
  "S=~/x; cd $S && git push origin main",
  "for k in a b; do git push origin --delete probe/$k-r2; done",
  'git push origin "probe/$N-r2"',
  'git push origin "x$N:wt/y"',
  "S=<out>; unset T U; cd $S && git push origin main",
  "S=<out>; unset -f S; cd $S && git push origin main",
  'S=<out>; G="git -C $S"; $G push origin main',
  "git push origin {probe,wt/x}",
  'X="A=1"; $X git push origin main',
  "git push origin 'refs/heads/wt/*:refs/heads/wt/*'",
  "for b in {a,b}; do git push origin probe/$b; done",
];

/** Lines that push main by a value the line sets. */
const sendingMain = [
  'B=main; git push origin "$B"',
  "HOME=<root>; cd ~ && git push origin main",
  "for b in wt/x main; do git push origin $b; done",
  "IFS=; B=main; git push origin $B",
  "A+=x git push origin main",
  "B[0]=y git push origin main",
  "unset A; B=main; git push origin $B",
  "git push origin {probe,main}",
  "E=; $E git push origin main",
  "git push origin 'refs/heads/*:refs/heads/*'",
  "git push origin --delete 'refs/heads/m*'",
  "git push origin ma*",
  'A="origin main"; git push $A',
  'IFS=:; A="origin:main"; git push $A',
  'R=<root>; G="git -C $R"; $G push origin main',
  "IFS=x; A=originxHEAD:main; git push $A",
  "X=GIT_DIR=<root>/.git; env $X git push origin main",
];

describe("pushes after variables the line sets", () => {
  it("follows a dir or a ref the line sets to a value it can read", () => {
    for (const line of followed) expect(pushFromRoot(line), line).toBeNull();
  });

  it("denies a push of main that a value the line sets names", () => {
    for (const line of sendingMain) expect(pushFromRoot(line), line).toBe(pushDeny("pull-request"));
  });
});

describe("pushes whose value the line loses", () => {
  it("denies a push whose value the line loses or the shell may split into main", () => {
    const unread = [
      'git push origin "wt/$N"',
      'git push origin "x$N:main"',
      'git push origin "x$N:"',
      'git push origin "+$N"',
      "if c; then S=<out>; fi; cd $S && git push origin main",
      "S=<out>; unset S; cd $S && git push origin main",
      "S=<out>; unset -n T; cd $S && git push origin main",
      "S=<out>; read S; cd $S && git push origin main",
      "cd ~bob && git push origin main",
      "S=<out>; eval S=<root>; cd $S && git push origin main",
      "CDPATH=<out>; cd x && git push origin main",
    ];

    for (const line of unread) expect(pushFromRoot(line), line).toMatch(UNREAD);
  });
});

describe("other git rules after variables the line sets", () => {
  it("judges a branch or ref the line sets as main", () => {
    const r = repoWithWorktree();

    for (const cmd of ['B=main; git branch -D "$B"', "B=main; git update-ref refs/heads/$B x"])
      expect(sharedAs("worktree", { cmd, place: at(r) }), cmd).toMatch(/^main is the shared default branch/);
  });

  it("judges a worktree add target the line sets", () => {
    const r = repoWithWorktree();
    const place = { cwd: r, roots: { root: r } };
    const managed = `'${path.join(r, ".worktrees", "b")}'`;

    expect(worktreeAddReason("T=/x; git worktree add $T", place)).toMatch(/^worktrees live in /);
    expect(worktreeAddReason(`T=${managed}; git worktree add $T -b wt/b`, place)).toBeNull();
  });
});
