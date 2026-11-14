import fs from "node:fs";
import path from "node:path";

import { afterEach, expect, it, vi } from "vitest";

import { prRepo, PR_URL, squashMerge } from "./__fixtures__/worktree-pr.ts";
import {
  captured,
  commitIn,
  git,
  hasBranch,
  hasTracking,
  scratch,
  short,
  stdinOf,
  wt,
  type Run,
} from "./__fixtures__/worktree-repo.ts";
import { finishWith } from "./worktree-lifecycle.ts";
import { main } from "./worktree.ts";
import type { FinishDeps } from "./worktree.types.ts";

const tmp = scratch();

afterEach(() => tmp.cleanup());

/**
 * `main(["finish", "a"])` in `r` with the harness project-dir vars removed and `deps` in place of gh and the config.
 */
function finishCli(r: string, deps: FinishDeps): Run {
  for (const k of ["GROK_WORKSPACE_ROOT", "CLAUDE_PROJECT_DIR"]) vi.stubEnv(k, undefined);
  process.chdir(r);
  const { value, stdout, stderr } = captured(() => main(["finish", "a"], stdinOf(""), deps));

  return { code: value, stderr, stdout };
}

/** True when the worktree, the local branch and origin's tracking copy of `wt/a` are all gone. */
function cleaned(r: string): boolean {
  return !fs.existsSync(wt(r, "a")) && !hasBranch(r, "wt/a") && !hasTracking(r, "wt/a");
}

it.each([true, false])("lands a squash-merged pull request when origin dropped its branch: %s", (drop) => {
  const { r, bare, fake, deps } = prRepo(tmp);
  finishWith(deps)(r, "a");
  squashMerge(r, fake, drop);
  expect(finishWith(deps)(r, "a")).toStrictEqual({
    branch: "wt/a",
    defaultBranch: "main",
    kind: "landed",
    path: wt(r, "a"),
    sha: short(r, "main"),
    url: PR_URL,
  });
  expect(git(r, "rev-parse", "main")).toBe(git(bare, "rev-parse", "main"));
  expect([cleaned(r), git(bare, "branch", "--list", "wt/a")]).toStrictEqual([true, ""]);
  expect(fs.readFileSync(path.join(r, "a.txt"), "utf8")).toBe("a.txt");
});

it("converges on a rerun after a crash removed the worktree and branch: fast-forwards and syncs", () => {
  const { r, fake, deps } = prRepo(tmp);
  commitIn(r, "repo-marker.js", "require('fs').writeFileSync('synced.marker', process.argv.slice(2).join(' '));\n");
  commitIn(
    r,
    "package.json",
    `${JSON.stringify({ name: "fixture", private: true, scripts: { repo: "node repo-marker.js" } })}\n`,
  );
  git(r, "push", "-q", "--no-verify", "origin", "main");
  finishWith(deps)(r, "a");
  squashMerge(r, fake, true);
  git(r, "worktree", "remove", wt(r, "a"));
  git(r, "branch", "-D", "wt/a");
  expect(finishWith(deps)(r, "a")).toMatchObject({ kind: "landed", sha: short(r, "main") });
  expect(git(r, "rev-parse", "main")).toBe(git(r, "rev-parse", "origin/main"));
  expect(fs.readFileSync(path.join(r, "synced.marker"), "utf8")).toBe("sync");
});

it("refuses a merged pull request whose branch has commits it lacks, and keeps them", () => {
  const { r, fake, deps } = prRepo(tmp);
  finishWith(deps)(r, "a");
  commitIn(wt(r, "a"), "late.txt");
  squashMerge(r, fake, true);
  const before = git(r, "rev-parse", "main");
  expect(() => finishWith(deps)(r, "a")).toThrow(
    `wt/a has commits its merged pull request ${PR_URL} lacks: run bun repo worktree add a2, cherry-pick them there, ` +
      "then run finish a again to clean up",
  );
  expect([fs.existsSync(wt(r, "a")), hasBranch(r, "wt/a"), git(r, "rev-parse", "main")]).toStrictEqual([
    true,
    true,
    before,
  ]);
});

it("refuses a pull request closed without merging and keeps the branch", () => {
  const { r, fake, deps } = prRepo(tmp);
  finishWith(deps)(r, "a");
  fake.state = "CLOSED";
  expect(() => finishWith(deps)(r, "a")).toThrow(
    `the pull request for wt/a was closed without merging (${PR_URL}): ` +
      "reopen it with gh pr reopen 7, then run finish again",
  );
  expect([fs.existsSync(wt(r, "a")), hasBranch(r, "wt/a")]).toStrictEqual([true, true]);
});

it("throws git's reason when the local main cannot fast-forward to origin's", () => {
  const { r, fake, deps } = prRepo(tmp);
  finishWith(deps)(r, "a");
  squashMerge(r, fake, true);
  commitIn(r, "local.txt");
  expect(() => finishWith(deps)(r, "a")).toThrow(`could not fast-forward main in ${r} to origin/main: `);
  expect(hasBranch(r, "wt/a")).toBe(true);
});

it("prints the opened, updated and landed lines, and a closed pull request exits 1", () => {
  const { r, fake, deps } = prRepo(tmp);
  const again = "run bun repo worktree finish a again once it merges\n";
  expect(finishCli(r, deps)).toStrictEqual({
    code: 0,
    stderr: "",
    stdout: `pushed wt/a and opened ${PR_URL}; ${again}`,
  });
  commitIn(wt(r, "a"), "b.txt");
  expect(finishCli(r, deps)).toStrictEqual({ code: 0, stderr: "", stdout: `pushed wt/a to ${PR_URL}; ${again}` });
  fake.state = "CLOSED";
  expect(finishCli(r, deps)).toMatchObject({ code: 1, stdout: "" });
  squashMerge(r, fake, true);
  const landed = finishCli(r, deps);
  expect(landed).toStrictEqual({
    code: 0,
    stderr: "",
    stdout:
      `wt/a merged through ${PR_URL}; main is at ${short(r, "main")} and removed ${wt(r, "a")}; ` +
      `your shell may still be in it: cd ${r}\n`,
  });
});
