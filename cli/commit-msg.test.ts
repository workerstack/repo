import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { describe, expect, it, vi } from "vitest";
import { checkCommitMessage, isTestFile, runCommitMsgHook } from "./commit-msg.mjs";

const ok = (message: string, stagedFiles: string[] = ["src/a.test.ts"], scopes?: string[]) =>
  checkCommitMessage(message, { stagedFiles, scopes });

describe("checkCommitMessage", () => {
  it("accepts every listed type", () => {
    for (const type of ["feat", "fix", "perf", "refactor", "test", "docs", "build", "ci", "chore", "revert"]) {
      expect(ok(`${type}: do the thing`)).toEqual([]);
    }
  });

  it("accepts a scope and a breaking marker", () => {
    expect(ok("feat(paths)!: drop the old spelling")).toEqual([]);
  });

  it("rejects a header that is not type(scope)!: subject", () => {
    expect(ok("added stuff")).toEqual([
      'the header must be "type(scope)!: subject", e.g. "fix(paths): compare hook paths canonically"',
    ]);
  });

  it("rejects an unknown type", () => {
    expect(ok("feature: x")).toEqual([
      'unknown type "feature"; use one of feat, fix, perf, refactor, test, docs, build, ci, chore, revert',
    ]);
  });

  it("rejects a scope outside the workspace when scopes are given", () => {
    expect(ok("chore(nope): x", [], ["backend"])).toEqual([
      'unknown scope "nope"; use a workspace package name or one of repo, deps, ci (backend)',
    ]);
    expect(ok("fix(backend): x", ["a.test.ts"], ["backend"])).toEqual([]);
    expect(ok("chore(deps): x", [], ["backend"])).toEqual([]);
  });

  it("rejects a scope that is not lowercase kebab-case", () => {
    expect(ok("fix(Paths): x")).toEqual(['the scope "Paths" must be lowercase kebab-case']);
  });

  it("rejects a subject that is capitalised, ends in a period or makes the header too long", () => {
    expect(ok("fix: Compare paths")).toEqual(["the subject must start lowercase"]);
    expect(ok("fix: compare paths.")).toEqual(["the subject must not end with a period"]);
    expect(ok(`fix: ${"a".repeat(96)}`)).toEqual(["the header is 101 characters; keep it to 100"]);
  });

  it("needs a test change for feat and fix", () => {
    expect(ok("feat: x", ["src/a.ts"])).toEqual([
      "a feat commit must include a test change (a *.test.* or *.spec.* file, or a file under e2e/)",
    ]);
    expect(ok("fix: x", [])).toEqual([
      "a fix commit must include a test change (a *.test.* or *.spec.* file, or a file under e2e/)",
    ]);
    expect(ok("docs: x", [])).toEqual([]);
  });

  it("treats a BREAKING CHANGE footer like a breaking marker", () => {
    expect(ok("refactor: x\n\nBREAKING CHANGE: gone", [])).toEqual([]);
  });

  it("ignores git's comment lines and leading blank lines", () => {
    expect(ok("\n# Please enter the commit message\nchore: x\n# On branch main", [])).toEqual([]);
  });

  it("rejects an empty message", () => {
    expect(ok("# only comments\n", [])).toEqual(["the commit message is empty"]);
  });

  it("lets git's own merge commits through", () => {
    expect(ok("Merge branch 'x' into main", [])).toEqual([]);
  });
});

describe("isTestFile", () => {
  it("knows test files", () => {
    expect(isTestFile("cli/a.test.ts")).toBe(true);
    expect(isTestFile("src/a.spec.tsx")).toBe(true);
    expect(isTestFile("e2e/run.ts")).toBe(true);
    expect(isTestFile("packages/x/e2e/run.ts")).toBe(true);
    expect(isTestFile("src/attest.ts")).toBe(false);
  });
});

describe("runCommitMsgHook", () => {
  const write = (text: string) => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "commit-msg-")), "COMMIT_EDITMSG");
    fs.writeFileSync(file, text);
    return file;
  };

  it("returns 0 for a good message", () => {
    expect(runCommitMsgHook(write("docs: x\n"), { stagedFiles: () => [] })).toBe(0);
  });

  it("prints every problem and returns 1 for a bad one", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(runCommitMsgHook(write("Feat: X.\n"), { stagedFiles: () => [] })).toBe(1);
    expect(error.mock.calls.map((c) => c[0])).toEqual([
      "commit-msg: the message was refused",
      '  - unknown type "Feat"; use one of feat, fix, perf, refactor, test, docs, build, ci, chore, revert',
      "  - the subject must start lowercase",
      "  - the subject must not end with a period",
    ]);
    error.mockRestore();
  });

  it("reads the staged files from git", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "commit-msg-repo-"));
    execFileSync("git", ["init", "-q"], { cwd: dir });
    fs.writeFileSync(path.join(dir, "a.test.ts"), "");
    execFileSync("git", ["add", "a.test.ts"], { cwd: dir });
    const cwd = process.cwd();
    try {
      process.chdir(dir);
      expect(runCommitMsgHook(write("fix: x\n"))).toBe(0);
    } finally {
      process.chdir(cwd);
    }
  });

  it("counts no staged files outside a git repo", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "commit-msg-git-"));
    const cwd = process.cwd();
    try {
      process.chdir(dir);
      expect(runCommitMsgHook(write("fix: x\n"))).toBe(1);
    } finally {
      process.chdir(cwd);
      error.mockRestore();
    }
  });
});
