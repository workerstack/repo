import fs from "node:fs";
import path from "node:path";

import { expect, it } from "vitest";

import { tmp } from "./__fixtures__/doctor-kit.ts";
import {
  commitIn,
  doctor,
  git,
  gitRepo,
  leftoverPatterns,
  put,
  REPO_IGNORES,
  section,
  seedLeftovers,
  seedStale,
} from "./__fixtures__/doctor-workspace-kit.ts";
import { addWorktree } from "./worktree-lifecycle.ts";

it("lists each leftover with the command that clears it, groups worktrees, and deletes nothing", () => {
  const r = gitRepo("doc-ws-", `.tmp\n.tmp/\n.worktrees/\n${REPO_IGNORES}`);
  expect(doctor(path.join(r, "packages", "a")).code).toBe(0);
  const { gone, m, outside, seeded } = seedLeftovers(r);
  const res = doctor(path.join(r, "packages", "a"));
  expect(res.code).toBe(0);
  const { head, items } = section(res.stdout);
  expect(head).toMatch(/^workspace\s+8 to clear\s+report only; nothing was deleted$/);
  const want = leftoverPatterns(r, outside);
  expect(items.length, res.stdout).toBe(want.length);

  for (const [i, re] of want.entries()) expect(items[i]).toMatch(new RegExp(re));

  for (const f of seeded) expect(fs.existsSync(f), f).toBe(true);
  expect(fs.existsSync(outside)).toBe(true);
  expect(fs.existsSync(m)).toBe(true);
  expect(git(r, "worktree", "list").stdout).toContain(gone.split(path.sep).join("/"));
});

it("lists an unmerged managed worktree whose last commit is 7 or more days old, with its finish command", () => {
  const r = gitRepo("doc-ws-stale-", ".tmp/\n.worktrees/\n");
  const { old } = seedStale(r);
  const res = doctor(path.join(r, "packages", "a"));
  const { head, items } = section(res.stdout);

  function line(name: string, days: number): string {
    const at = path.join(r, ".worktrees", name);

    return `- stale worktree ${at} (wt/${name}, last commit ${days} days ago): bun repo worktree finish ${name}`;
  }

  expect(items, res.stdout).toStrictEqual([
    `- merged worktree ${path.join(r, ".worktrees", "landed")} (wt/landed): bun repo worktree prune`,
    line("dirty", 12),
    line("edge", 7),
    line("old", 9),
  ]);
  expect(head).toMatch(/^workspace\s+4 to clear\s+report only; nothing was deleted$/);
  expect(fs.existsSync(old)).toBe(true);
  expect(git(r, "rev-parse", "--verify", "-q", "refs/heads/wt/old").status).toBe(0);
});

it("skips repo's own scratch, nested repos, partly useful or glob ignores, fresh and dirty worktrees", () => {
  const r = gitRepo("doc-ws-quiet-", `.tmp/\n.worktrees/\n${REPO_IGNORES}`);
  expect(section(doctor(r).stdout).head).toMatch(/^workspace\s+ok\s*$/);
  put(r, ".repo/scratch/verify/S/.repo/tmp/x");
  put(r, ".repo/tmp/stash/x");
  fs.mkdirSync(path.join(r, "vendor", "sub"), { recursive: true });
  git(path.join(r, "vendor", "sub"), "init", "-q");
  put(r, "vendor/sub/.repo/tmp/x");
  put(r, "packages/c/.gitignore", ".tmp/\ndist-local/\n");
  put(r, "packages/g/.gitignore", "*.log\n");
  addWorktree(r, "f");
  const d = addWorktree(r, "d").path;
  commitIn(d, "d.txt");
  git(r, "merge", "-q", "wt/d");
  put(d, "dirty.txt");
  const res = doctor(path.join(r, "packages", "a"));
  const quiet = section(res.stdout);
  expect(quiet.head, res.stdout).toMatch(/^workspace\s+ok\s*$/);
  expect(quiet.items, res.stdout).toStrictEqual([]);
  expect(section(doctor(tmp("doc-ws-nogit-")).stdout).head).toMatch(/^workspace\s+ok\s*$/);
});

it("reads the git top's .gitignore for a repo install in a subpackage", () => {
  const r = gitRepo("doc-ws-sub-", ".tmp\n.tmp/\n");
  const web = path.join(r, "apps", "web");
  put(web, "workerstack.config.ts", "");
  put(web, ".gitignore", ".tmp/\n");
  const { items } = section(doctor(web).stdout);
  const top = path.join(r, ".gitignore");
  const redundant = `- redundant .gitignore ${path.join(web, ".gitignore")} (".tmp/" ignored by ${top}:`;
  expect(items.some((l) => l.startsWith(redundant))).toBe(true);
  expect(items).toContain(
    `- duplicate .gitignore line ${top}:2 ".tmp/" (".tmp" on line 1 covers it): delete line 2 of ${top}`,
  );
});
