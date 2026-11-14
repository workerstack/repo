import path from "node:path";

import { describe, expect, it } from "vitest";

import type { WorkflowRead } from "../workflow.ts";
import { FORCE, pushDeny, reading, sharedAs, STRICT, useGuardRepos } from "./__fixtures__/workflow-guards.ts";
import { NONE, at, git, write, wt } from "./__fixtures__/worktree-repo.ts";
import type { Runner } from "./ci-wait-run.ts";
import { mainCheckoutRefusal } from "./lessons-ops.ts";
import { mainCheckoutWriteReason, sharedGitReason } from "./worktree-guards.ts";
import type { ShellAt } from "./worktree.types.ts";

const { repoWithWorktree, tmp } = useGuardRepos();

const SHARED_WRITE = /^the main checkout is shared: run bun repo worktree add <name> /;
const PR_ONLY = / takes changes only through pull requests /;
const WIN_GUARD = { committed: () => true, p: path.win32 };
const ASKS = "run it only when the user's message asks for git ";

/** `mainCheckoutWriteReason` for a win32 write into the main checkout `C:\\r` under `read`. */
function check(read: WorkflowRead) {
  return mainCheckoutWriteReason("C:\\r\\src\\x.ts", at("C:\\r").roots, { ...WIN_GUARD, workflow: reading(read) });
}

function boom(): never {
  throw new Error("git is gone");
}

/** What the fake git prints for `args`: HEAD is `wt/a`, every name its own branch, and every ref one commit. */
function fakeOut(args: string[]): string {
  const ref = String(args.at(-1));

  if (args.includes("--abbrev-ref")) return "wt/a\n";

  return args.includes("--symbolic-full-name") ? `refs/heads/${ref === "HEAD" ? "wt/a" : ref}\n` : "abc123\n";
}

/** A git that answers {@link fakeOut}. */
function fakeGit(args: string[]) {
  return { code: 0, stderr: "", stdout: fakeOut(args) };
}

describe("main checkout writes follow the workflow", () => {
  it("lets a write into the main checkout through under main", () => {
    const r = tmp.repo();
    const workflow = reading("main");
    expect(mainCheckoutWriteReason(path.join(r, "src/a.ts"), at(r).roots, { workflow })).toBeNull();
    expect(workflow).toHaveBeenCalledWith(r);
  });

  it("denies with the worktree text under pull-request and an unreadable config", () => {
    const r = tmp.repo();
    const target = path.join(r, "src/a.ts");
    const text = mainCheckoutWriteReason(target, at(r).roots, { workflow: reading("worktree") });
    expect(text).toMatch(SHARED_WRITE);

    for (const read of STRICT)
      expect(mainCheckoutWriteReason(target, at(r).roots, { workflow: reading(read) }), read).toBe(text);
  });

  it("reads no workflow for a write it lets through anyway", () => {
    const r = tmp.repo();
    const unborn = tmp.dir("wt-unborn-");
    git(unborn, "init", "-q", "-b", "main");
    const workflow = reading("pull-request");

    for (const target of [path.join(r, ".repo/plans/p.md"), path.join(r, ".worktrees/a/x.ts"), "/elsewhere/x.ts"])
      expect(mainCheckoutWriteReason(target, at(r).roots, { workflow }), target).toBeNull();

    expect(mainCheckoutWriteReason(path.join(unborn, "x.ts"), at(unborn).roots, { workflow })).toBeNull();
    expect(workflow).not.toHaveBeenCalled();
  });
});

describe("main checkout write texts on win32 and for lessons", () => {
  it("reads win32 spellings under each workflow", () => {
    expect(check("main")).toBeNull();
    expect(check("worktree")).toContain("write under C:\\r\\.worktrees\\<name>;");

    for (const read of STRICT) expect(check(read), read).toBe(check("worktree"));
  });

  it("lets lessons change in the main checkout when its config names main", () => {
    const r = tmp.repo();
    expect(mainCheckoutRefusal(r)).toMatch(/^the main checkout is shared/);
    const flat = tmp.repo();
    write(path.join(flat, "repo.config.ts"), 'export default { workflow: "main" };\n');
    expect(mainCheckoutRefusal(flat)).toBeNull();
  });
});

describe("main checkout git commands follow the workflow", () => {
  it("lets commits through in the root under main", () => {
    const place = at(repoWithWorktree());

    for (const cmd of ["git commit -m x", "git merge wt/a", "git pull", "git am x.patch", "git cherry-pick wt/a"])
      expect(sharedAs("main", { cmd, place }), cmd).toBeNull();
  });

  it("keeps the destroy and shared-ref denies under main", () => {
    const place = at(repoWithWorktree());

    for (const sub of ["reset", "checkout", "stash", "clean", "restore", "rebase", "switch"]) {
      const text = `git ${sub} in the main checkout can destroy uncommitted work: ${ASKS}${sub}`;
      expect(sharedAs("main", { cmd: `git ${sub} x`, place }), sub).toBe(text);
    }

    const shared = /^main is the shared default branch/;
    expect(sharedAs("main", { asked: new Set(["reset"]), cmd: "git reset --hard", place })).toBeNull();
    expect(sharedAs("main", { cmd: "git branch -D main", place })).toMatch(shared);
    expect(sharedAs("main", { cmd: "git update-ref refs/heads/main HEAD", place })).toMatch(shared);
    expect(sharedAs("main", { cmd: "git push --force origin main", place })).toMatch(/^a force push rewrites/);
    expect(sharedAs("main", { cmd: "git push origin main", place })).toBeNull();
  });

  it("denies commits with the worktree text under pull-request and an unreadable config", () => {
    const place = at(repoWithWorktree());

    for (const cmd of ["git commit -m x", "git reset --hard", "git branch -D main"]) {
      const text = sharedAs("worktree", { cmd, place }) ?? "no worktree deny";

      for (const read of STRICT) expect(sharedAs(read, { cmd, place }), `${read} ${cmd}`).toBe(text);
    }
  });
});

describe("pushes of main", () => {
  it.each(STRICT)("denies every push of main from the root under %s", (read) => {
    const place = at(repoWithWorktree());
    const deny = pushDeny(read);
    expect(sharedAs(read, { cmd: "git push origin main", place })).toBe(deny);
    expect(sharedAs(read, { cmd: "git push", place })).toBe(deny);
    expect(sharedAs(read, { cmd: "rtk git push origin main", place })).toBe(deny);
    expect(sharedAs(read, { cmd: `git push -o "note='x y'" origin main`, place })).toBe(deny);
    expect(sharedAs(read, { cmd: "git push --mirror origin", place })).toBe(deny);
    expect(sharedAs(read, { asked: FORCE, cmd: "git push origin +main", place })).toBe(deny);
  });

  it.each(STRICT)("denies every push of main from a worktree under %s", (read) => {
    const r = repoWithWorktree();
    const place = at(r, wt(r, "a"));
    const deny = pushDeny(read);
    expect(sharedAs(read, { cmd: "git push origin HEAD:main", place })).toBe(deny);
    expect(sharedAs(read, { cmd: "git push origin refs/heads/main", place })).toBe(deny);
    expect(sharedAs(read, { cmd: "git push -u origin wt/a && git push origin main", place })).toBe(deny);
    expect(sharedAs(read, { cmd: "git push origin --all", place })).toBe(deny);
    expect(sharedAs(read, { asked: FORCE, cmd: "git push --force origin main", place })).toBe(deny);
  });
});

describe("pushes of other branches", () => {
  it.each(STRICT)("lets a push of a worktree branch through under %s", (read) => {
    const r = repoWithWorktree();
    const place = at(r, wt(r, "a"));
    expect(sharedAs(read, { cmd: "git push -u origin wt/x", place: at(r) })).toBeNull();
    expect(sharedAs(read, { cmd: "git push", place })).toBeNull();
    expect(sharedAs(read, { cmd: "git push origin wt/a", place })).toBeNull();
    expect(sharedAs(read, { cmd: "git push origin no-such-branch", place })).toBeNull();
    expect(sharedAs(read, { cmd: "git push --force origin wt/a", place })).toMatch(/^a force push rewrites/);
    expect(sharedAs(read, { asked: FORCE, cmd: "git push --force origin wt/a", place })).toBeNull();
  });

  it("fails closed when resolving the pushed refs throws", () => {
    const place = at(repoWithWorktree());
    const line = { cmd: "git push origin wt/x", more: { git: boom }, place };
    expect(sharedAs("pull-request", line)).toBe(pushDeny("pull-request"));
  });

  it("lets main pushes through under worktree and main", () => {
    const place = at(repoWithWorktree());

    for (const read of ["worktree", "main"] as const) {
      expect(sharedAs(read, { cmd: "git push origin main", place }), read).toBeNull();
      expect(sharedAs(read, { cmd: "git push origin --all", place }), read).toBeNull();
      expect(sharedAs(read, { asked: FORCE, cmd: "git push --force origin main", place }), read).toBeNull();
    }
  });
});

describe("where the push check reads the workflow", () => {
  it("reads no workflow without a push in the repo, or before the first commit", () => {
    const r = repoWithWorktree();
    const unborn = tmp.dir("wt-unborn-");
    git(unborn, "init", "-q", "-b", "main");
    const outside = tmp.dir("wt-out-");
    const workflow = reading("pull-request");

    for (const [cmd, place] of [
      ["git status && git log", at(r)],
      [`git -C '${outside}' push origin main`, at(r)],
      ["cat <<'EOF'\ngit push origin main\nEOF", at(r)],
      ["git push origin main", at(unborn)],
    ] as const)
      expect(sharedGitReason(cmd, { ...place, asked: NONE }, { workflow }), cmd).toBeNull();

    expect(workflow).not.toHaveBeenCalled();
  });

  it("reads the workflow from the root's repo.config.ts", () => {
    const r = repoWithWorktree();
    write(path.join(r, "repo.config.ts"), 'export default { workflow: "pull-request" };\n');
    write(path.join(wt(r, "a"), "repo.config.ts"), 'export default { workflow: "main" };\n');
    expect(sharedGitReason("git push origin HEAD:main", { ...at(r, wt(r, "a")), asked: NONE })).toBe(
      pushDeny("pull-request"),
    );
  });
});

describe("win32 pushes of the default branch", () => {
  const winRoot = at("C:\\r");
  const winInA = at("C:\\r", "C:\\r\\.worktrees\\a");

  function winShared(cmd: string, place: ShellAt = winRoot, runner: Runner = fakeGit) {
    const guard = { ...WIN_GUARD, git: runner, workflow: reading("pull-request") };

    return sharedGitReason(cmd, { ...place, asked: NONE }, guard);
  }

  it("reads win32 spellings of the root and its worktrees", () => {
    expect(winShared("git push origin --all")).toMatch(/ \(workflow is pull-request\): run bun repo worktree finish /);
    expect(winShared("git -C C:/r/.worktrees/a push --mirror")).toMatch(PR_ONLY);
    expect(winShared("git -C 'C:\\r\\.worktrees\\a' push origin --all")).toMatch(PR_ONLY);
    expect(winShared("git push origin wt/x", winInA)).toBeNull();
    expect(winShared("git push", winInA)).toBeNull();
    expect(winShared("git -C D:/other push origin --all")).toBeNull();
    expect(winShared("git push origin wt/x", winInA, boom)).toMatch(PR_ONLY);
  });
});
