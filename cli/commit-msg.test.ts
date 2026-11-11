import { describe, expect, it } from "vitest";
import { checkCommitMessage } from "./commit-msg.ts";
import { isTestFile } from "./test-files.ts";

const ok = (message: string, stagedFiles: string[] = ["src/a.test.ts"], scopes?: string[]) =>
  checkCommitMessage(message, { stagedFiles, scopes, changedLines: 0, maxChangedLines: 1000 });
const sized = (message: string, changedLines: number) =>
  checkCommitMessage(message, { stagedFiles: [], changedLines, maxChangedLines: 1000 });
const OVER = "the commit changes 1240 lines, over the limit of 1000; add a body line saying why, or split it";

describe("checkCommitMessage", () => {
  it("accepts every listed type", () => {
    for (const type of ["feat", "fix", "perf", "refactor", "test", "docs", "build", "ci", "chore", "revert"]) {
      expect(ok(`${type}: do the thing`)).toStrictEqual([]);
    }
  });

  it("accepts a scope and a breaking marker", () => {
    expect(ok("feat(paths)!: drop the old spelling")).toStrictEqual([]);
  });

  it("rejects a header that is not type(scope)!: subject", () => {
    expect(ok("added stuff")).toStrictEqual([
      'the header must be "type(scope)!: subject", e.g. "fix(paths): compare hook paths canonically"',
    ]);
  });

  it("rejects an unknown type", () => {
    expect(ok("feature: x")).toStrictEqual([
      'unknown type "feature"; use one of feat, fix, perf, refactor, test, docs, build, ci, chore, revert',
    ]);
  });

  it("rejects a scope outside the workspace when scopes are given", () => {
    expect(ok("chore(nope): x", [], ["backend"])).toStrictEqual([
      'unknown scope "nope"; use a workspace package name or one of repo, deps, ci (backend)',
    ]);
    expect(ok("fix(backend): x", ["a.test.ts"], ["backend"])).toStrictEqual([]);
    expect(ok("chore(deps): x", [], ["backend"])).toStrictEqual([]);
  });

  it("rejects a scope that is not lowercase kebab-case", () => {
    expect(ok("fix(Paths): x")).toStrictEqual(['the scope "Paths" must be lowercase kebab-case']);
  });

  it("rejects a subject that is capitalised, ends in a period or makes the header too long", () => {
    expect(ok("fix: Compare paths")).toStrictEqual(["the subject must start lowercase"]);
    expect(ok("fix: compare paths.")).toStrictEqual(["the subject must not end with a period"]);
    expect(ok(`fix: ${"a".repeat(96)}`)).toStrictEqual(["the header is 101 characters; keep it to 100"]);
  });

  it("needs a test change for feat and fix", () => {
    expect(ok("feat: x", ["src/a.ts"])).toStrictEqual([
      "a feat commit must include a test change (a *.test.* or *.spec.* file, or a file under e2e/)",
    ]);
    expect(ok("fix: x", [])).toStrictEqual([
      "a fix commit must include a test change (a *.test.* or *.spec.* file, or a file under e2e/)",
    ]);
    expect(ok("docs: x", [])).toStrictEqual([]);
  });

  it("treats a BREAKING CHANGE footer like a breaking marker", () => {
    expect(ok("refactor: x\n\nBREAKING CHANGE: gone", [])).toStrictEqual([]);
  });

  it("ignores git's comment lines and leading blank lines", () => {
    expect(ok("\n# Please enter the commit message\nchore: x\n# On branch main", [])).toStrictEqual([]);
  });

  it("rejects an empty message", () => {
    expect(ok("# only comments\n", [])).toStrictEqual(["the commit message is empty"]);
  });

  it("lets git's own merge commits through", () => {
    expect(ok("Merge branch 'x' into main", [])).toStrictEqual([]);
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

describe("the commit size limit", () => {
  it("refuses a commit over the limit with no body, and takes a body line as the reason", () => {
    expect(sized("chore: x", 1000)).toStrictEqual([]);
    expect(sized("chore: x", 1240)).toStrictEqual([OVER]);
    expect(sized("chore: x\n\nReformat from the oxfmt upgrade.", 1240)).toStrictEqual([]);
  });

  it("does not take a comment or git's verbose diff as the reason", () => {
    expect(sized("chore: x\n\n# why\n", 1240)).toStrictEqual([OVER]);
    const verbose = "chore: x\n# ------------------------ >8 ------------------------\ndiff --git a/x b/x\n+y\n";
    expect(sized(verbose, 1240)).toStrictEqual([OVER]);
  });
});
