import { describe, expect, it } from "vitest";

import { amending, commitAmends, type Proc, readProc } from "./commit-amend.ts";

/** How the hook tells `git commit --amend` from a plain commit: git's argv, found up the process chain. */

describe("commitAmends reads git's argv", () => {
  it.each([
    [["commit", "--amend"], true],
    [["commit", "--amend", "--no-edit"], true],
    [["commit", "--am"], true],
    [["commit", "--ame", "-m", "x"], true],
    [["commit", "--amen"], true],
    [["-C", "/r", "-c", "a=b", "--git-dir", "/r/.git", "--no-pager", "commit", "--amend"], true],
    [["--work-tree=/r", "commit", "-q", "--amend"], true],
    [["commit", "--amend", "--no-amend"], false],
    [["commit", "--no-amend", "--amend"], true],
    [["commit", "-m", "x"], false],
    [["commit", "-m", "--amend"], false],
    [["commit", "--message", "--amend", "-F", "--amend"], false],
    [["commit", "--", "--amend"], false],
    [["commit", "--a"], false],
    [["commit", "--amends"], false],
    [["-c", "commit", "--amend"], false],
    [["rebase", "--amend"], false],
    [[], false],
  ])("%j amends: %s", (argv, amends) => {
    expect(commitAmends(argv)).toBe(amends);
  });
});

/** A process table: pid to its parent and argv. */
function table(procs: Record<number, Proc>): (pid: number) => Proc | null {
  return (pid) => procs[pid] ?? null;
}

function hookScript(ppid: number): Proc {
  return { argv: ["/bin/sh", ".git/hooks/commit-msg"], ppid };
}

describe("amending walks up to the nearest git", () => {
  it("through a hook script and a process with no argv", () => {
    const read = table({
      10: hookScript(11),
      11: { argv: [], ppid: 12 },
      12: { argv: ["git", "commit", "--amend"], ppid: 13 },
    });

    expect(amending(10, read)).toBe(true);
    const amend = table({ 10: hookScript(12), 12: { argv: ["/usr/lib/git-core/git", "commit", "--amend"], ppid: 1 } });
    expect(amending(10, amend)).toBe(true);
  });

  it("taking the nearest git, an alias's re-run with the expanded argv", () => {
    const read = table({
      10: hookScript(11),
      11: { argv: ["git", "commit", "--amend"], ppid: 12 },
      12: { argv: ["git", "ca"], ppid: 1 },
    });

    expect(amending(10, read)).toBe(true);
  });

  it("naming git as git.exe or by a Windows path", () => {
    expect(amending(10, table({ 10: { argv: ["C:\\Git\\bin\\git.exe", "commit", "--amend"], ppid: 1 } }))).toBe(true);
  });

  it("and reads a plain commit when no git is found", () => {
    expect(amending(10, table({}))).toBe(false);
    expect(amending(1, table({ 1: { argv: ["git", "commit", "--amend"], ppid: 0 } }))).toBe(false);
    const deep = Object.fromEntries(Array.from({ length: 20 }, (_, n) => [n + 10, hookScript(n + 11)]));
    expect(amending(10, table({ ...deep, 30: { argv: ["git", "commit", "--amend"], ppid: 1 } }))).toBe(false);
  });
});

describe("amending with no arguments", () => {
  it("starts at this process's parent and reads /proc", () => {
    expect(amending()).toBe(amending(process.ppid, readProc));
  });
});

describe.runIf(process.platform === "linux")("readProc reads /proc", () => {
  it("for this process", () => {
    const self = readProc(process.pid);
    expect(self?.ppid).toBe(process.ppid);
    expect(self?.argv.length).toBeGreaterThan(0);
    expect(self?.argv.some((arg) => arg.includes("\0"))).toBe(false);
  });

  it("and is null for a pid that does not exist", () => {
    expect(readProc(2 ** 30)).toBeNull();
  });
});
