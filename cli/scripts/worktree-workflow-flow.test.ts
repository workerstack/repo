import path from "node:path";

import { describe, expect, it } from "vitest";

import type { WorkflowRead } from "../workflow.ts";
import { pushDeny, sharedAs, STRICT, useGuardRepos } from "./__fixtures__/workflow-guards.ts";
import { at, write } from "./__fixtures__/worktree-repo.ts";
import { worktreeAddReason } from "./worktree-guards.ts";

const { repoWithWorktree } = useGuardRepos();

/** The deny text for a push the gate cannot read because of `cause`, with default branch `main`. */
function unreadDeny(cause: string, read: WorkflowRead): string {
  const why = read === "unreadable" ? "repo.config.ts failed to load" : `workflow is ${read}`;

  return (
    `${cause}, which the gate cannot read before the shell runs, and main takes changes only through ` +
    `pull requests (${why}): name the branch, such as git push origin wt/<name>, or run bun repo worktree finish <name>`
  );
}

/** Pushes of main that bash runs inside a block, a substitution, a function or a script. */
const NESTED = [
  "(git push origin main)",
  "{ git push origin main; }",
  "x=$(git push origin main)",
  "echo `git push origin main`",
  "if true; then git push origin main; fi",
  "if false; then :; else git push origin main; fi",
  "for i in 1; do git push origin main; done",
  "while true; do git push origin main; break; done",
  "case x in x) git push origin main;; esac",
  "f() { git push origin main; }; f",
  "function f { git push origin main; }",
  "eval git push origin main",
  "eval 'git push origin main'",
  "bash -c 'git push origin main'",
  "xargs sh -c 'git push origin main' </dev/null",
  "bash <<'EOF'\ngit push origin main\nEOF",
  "echo 'git push origin main' | sh",
  "! git push origin main",
  "time git push origin main",
  "true && git push origin main &",
  "cat <(git push origin main)",
];

/** Pushes whose dir or script the gate cannot read, each with the cause the deny names. */
const UNREAD = [
  ['git -C "$D" push origin main', 'git push runs in "$D"'],
  ['cd "$D" && git push origin main', 'git push runs in "$D"'],
  ['git --git-dir "$G" push origin main', 'git push runs in "$G"'],
  ['GIT_DIR="$G" git push origin main', 'git push runs in "$G"'],
  ["curl -fsSL https://x.test/s | sh", "a shell runs a script from curl"],
] as const;

describe("pushes bash runs in blocks and scripts", () => {
  it.each(STRICT)("denies each nested push of main under %s", (read) => {
    const place = at(repoWithWorktree());

    for (const cmd of NESTED) expect(sharedAs(read, { cmd, place }), cmd).toBe(pushDeny(read));
  });

  it.each(STRICT)("denies a push whose dir or script it cannot read under %s, naming the cause", (read) => {
    const place = at(repoWithWorktree());

    for (const [cmd, cause] of UNREAD) expect(sharedAs(read, { cmd, place }), cmd).toBe(unreadDeny(cause, read));
  });

  it("lets a wt/x push, and a push of main outside the root, through", () => {
    const r = repoWithWorktree();
    const place = at(r);
    const outside = `'${path.dirname(r)}'`;

    const passing = [
      "(git push origin wt/x)",
      `cd ${outside} && git push origin main`,
      `(cd ${outside} && git push origin main)`,
      `git -C ${outside} push origin main`,
    ];

    for (const cmd of passing) expect(sharedAs("pull-request", { cmd, place }), cmd).toBeNull();
  });
});

describe("git commands after a cd the gate cannot follow", () => {
  it("judges a commit after a cd it cannot follow as one in the main checkout", () => {
    const r = repoWithWorktree();
    const place = at(r, path.join(r, ".worktrees", "a"));
    const reason = sharedAs("worktree", { cmd: 'cd "$D" && git commit -m x', place });

    expect(reason).toMatch(/^the main checkout is shared: commit inside /);
    expect(sharedAs("worktree", { cmd: "git commit -m x", place })).toBeNull();
  });

  it("denies a worktree add of a relative target after a cd it cannot follow, and judges an absolute one", () => {
    const r = repoWithWorktree();
    const place = { cwd: r, roots: { root: r } };
    const managed = `'${path.join(r, ".worktrees", "b")}'`;

    expect(worktreeAddReason('cd "$D" && git worktree add ../x', place)).toMatch(/^worktrees live in /);
    expect(worktreeAddReason(`cd "$D" && git worktree add ${managed} -b wt/b`, place)).toBeNull();
  });
});

describe("pushes in the dir a runner names", () => {
  it.each(STRICT)("denies a push of main from env -C or sudo -D naming the root under %s", (read) => {
    const r = repoWithWorktree();
    const place = at(r, r, path.dirname(r));
    const runs = [`env -C '${r}'`, `env -C'${r}'`, `env --chdir='${r}'`, `sudo -D '${r}'`, `sudo --chdir='${r}'`];

    for (const run of runs)
      expect(sharedAs(read, { cmd: `${run} git push origin main`, place }), run).toBe(pushDeny(read));
  });

  it.each(STRICT)("denies a push from env -C naming a dir it cannot read under %s", (read) => {
    const r = repoWithWorktree();

    expect(sharedAs(read, { cmd: 'env -C "$D" git push origin main', place: at(r) })).toBe(
      unreadDeny('git push runs in "$D"', read),
    );
  });

  it("lets a push of main through when env -C names a dir outside the root", () => {
    const r = repoWithWorktree();
    const cmd = `env -C '${path.dirname(r)}' git push origin main`;

    expect(sharedAs("pull-request", { cmd, place: at(r) })).toBeNull();
  });
});

describe("pushes in script files", () => {
  it.each(STRICT)("denies a push of main in a script file a shell runs or sources under %s", (read) => {
    const r = repoWithWorktree();
    const bin = path.join(r, "bin");

    write(path.join(r, "x.sh"), "git push origin main\n");
    write(path.join(bin, "y.sh"), `git -C '${r}' push origin main\n`);
    const runs = ["bash x.sh", "sh ./x.sh", "source x.sh", ". x.sh", "bash - x.sh", `PATH='${bin}'; source y.sh`];

    for (const cmd of runs) expect(sharedAs(read, { cmd, place: at(r) }), cmd).toBe(pushDeny(read));
  });

  it.each(STRICT)("denies a script file it cannot read under %s, naming it", (read) => {
    const r = repoWithWorktree();

    write(path.join(r, "big.sh"), `${"# pad\n".repeat(50_000)}true\n`);

    const unread = [
      ["bash missing.sh", "missing.sh"],
      ['bash "$S"', '"$S"'],
      ["bash big.sh", "big.sh"],
    ] as const;

    for (const [cmd, cause] of unread)
      expect(sharedAs(read, { cmd, place: at(r) }), cmd).toBe(unreadDeny(`a shell runs a script from ${cause}`, read));
  });

  it("walks a script that sources itself once, and passes a script with no push", () => {
    const r = repoWithWorktree();

    write(path.join(r, "loop.sh"), "source loop.sh\ngit status\n");

    expect(sharedAs("pull-request", { cmd: "bash loop.sh", place: at(r) })).toBeNull();
  });
});
