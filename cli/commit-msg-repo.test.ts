import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { git, lines, put, removeTemps, tempDir } from "./__fixtures__/commit-repo.ts";
import { main } from "./commit-msg.ts";
import { NAME_A_SOURCE } from "./commit-range.constants.ts";
import { CONFIG_FILE } from "./config.constants.ts";
import { commitChange, stagedChange } from "./staged-change.ts";

/** `repo commit-msg` and the staged change it reads, on temp repos. */
const OVER = "the commit changes 1240 lines, over the limit of 1000; add a body line saying why, or split it";

afterEach(removeTemps);

/** A temp repo with `base` committed and `staged` written and added on top. */
function repo(base: Record<string, string | Buffer>, staged: Record<string, string | Buffer>): string {
  const root = tempDir();
  git(root, "init", "-q");
  put(root, {
    [CONFIG_FILE]: "export default {}\n",
    "package.json": JSON.stringify({ name: "app", private: true }),
    ...base,
  });
  git(root, "add", "-A");
  git(root, "commit", "-q", "--no-verify", "-m", "base");
  put(root, staged);
  git(root, "add", "-A");
  return root;
}

describe("stagedChange", () => {
  it("counts staged insertions and deletions, and lists every staged path", () => {
    const root = repo({ "a.ts": lines(10), "old.ts": lines(3) }, { "a.ts": lines(4), "b.test.ts": lines(5) });
    git(root, "mv", "old.ts", "new.ts");
    expect(stagedChange(root)).toStrictEqual({ changedLines: 11, files: ["a.ts", "b.test.ts", "new.ts"] });
  });

  it("leaves out lockfiles, the lint baseline, binaries and linguist-generated paths", () => {
    const skipped = ["bun.lock", "package-lock.json", "yarn.lock", "pnpm-lock.yaml", "api/bun.lock"];
    const staged = Object.fromEntries(
      [...skipped, ".repo/lint-baseline.json", "gen/out.ts"].map((rel) => [rel, lines(50)]),
    );
    const root = repo(
      { ".gitattributes": "gen/** linguist-generated\n" },
      { ...staged, "bun.lockb": Buffer.from([0, 1, 2]), "img.bin": Buffer.from([0, 9, 0]), "src/a.ts": lines(7) },
    );
    expect(stagedChange(root).changedLines).toBe(7);
  });

  it("reads linguist-generated from the staged .gitattributes", () => {
    const root = repo({}, { ".gitattributes": "gen/** linguist-generated=true\n", "gen/out.ts": lines(50) });
    expect(stagedChange(root).changedLines).toBe(1);
  });

  it("finds nothing staged outside a git repo", () => {
    expect(stagedChange(tempDir())).toStrictEqual({ changedLines: 0, files: [] });
    expect(commitChange(tempDir(), "HEAD")).toStrictEqual({ changedLines: 0, files: [] });
  });
});

/** Runs `repo commit-msg` on `message` in `root`; its exit code and what it printed. */
async function commitMsg(root: string, message: string) {
  fs.writeFileSync(path.join(root, ".git", "COMMIT_EDITMSG"), message);
  const err: string[] = [];
  const code = await main([".git/COMMIT_EDITMSG"], { cwd: root, stderr: (text) => err.push(text) });
  return { code, stderr: err.join("") };
}
function refused(...problems: string[]) {
  return {
    code: 1,
    stderr: `commit-msg: the message was refused\n${problems.map((problem) => `  - ${problem}\n`).join("")}`,
  };
}
const PASSED = { code: 0, stderr: "" };
const NEEDS_TEST = "a feat commit must include a test change (a *.test.* or *.spec.* file, or a file under e2e/)";

describe("repo commit-msg scopes", () => {
  it("takes scopes from the last segment of each workspace package name, or its folder", async () => {
    const root = repo(
      {
        "package.json": JSON.stringify({ name: "mono", private: true, workspaces: ["packages/*"] }),
        "packages/api/package.json": JSON.stringify({ name: "@acme/api" }),
        "packages/app/package.json": "{}",
      },
      { "src/x.test.ts": "x\n" },
    );
    expect(await commitMsg(root, "feat(web): add x\n")).toStrictEqual(
      refused('unknown scope "web"; use a workspace package name or one of repo, deps, ci (api, app)'),
    );
    expect(await commitMsg(root, "feat(api): add x\n")).toStrictEqual(PASSED);
    expect(await commitMsg(root, "chore(deps): bump\n")).toStrictEqual(PASSED);
  });

  it("lets a single-package repo use any kebab scope, and still needs a test for a feat", async () => {
    const root = repo({}, { "src/x.ts": "x\n" });
    expect(await commitMsg(root, "chore(web): x\n")).toStrictEqual(PASSED);
    expect(await commitMsg(root, "feat(web): x\n")).toStrictEqual(refused(NEEDS_TEST));
  });
});

describe("repo commit-msg size and setup", () => {
  it("refuses an oversized commit until its message says why, at the configured limit", async () => {
    const root = repo({}, { "src/a.test.ts": lines(4), "src/a.ts": lines(1236) });
    expect(await commitMsg(root, "fix: handle y\n")).toStrictEqual(refused(OVER));
    expect(await commitMsg(root, "fix: handle y\n\nReformat from the oxfmt upgrade.\n")).toStrictEqual(PASSED);
    put(root, { [CONFIG_FILE]: "export default { commit: { maxChangedLines: 1500 } }\n" });
    expect(await commitMsg(root, "fix: handle y\n")).toStrictEqual(PASSED);
  });

  it("says how to call it, and refuses on a config it cannot read", async () => {
    const write = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    expect(await main(["a", "b"])).toBe(1);
    expect(write).toHaveBeenCalledWith(NAME_A_SOURCE);
    write.mockRestore();
    const err: string[] = [];
    expect(await main([], { cwd: os.tmpdir(), stderr: (text) => err.push(text) })).toBe(1);
    expect(err).toStrictEqual([NAME_A_SOURCE]);
    const root = repo({}, { [CONFIG_FILE]: "export default { commit: 5 }\n" });
    expect(await commitMsg(root, "chore: x\n")).toStrictEqual({
      code: 1,
      stderr: "repo commit-msg: workerstack.config.ts: commit: must be an object like { maxChangedLines: 1000 }\n",
    });
  });

  it("checks with the defaults where there is no config", async () => {
    const root = repo({}, { "src/a.ts": lines(1240) });
    fs.rmSync(path.join(root, CONFIG_FILE));
    expect(await commitMsg(root, "chore: x\n")).toStrictEqual(refused(OVER));
  });
});

it("repo commit-msg refuses on a package.json it cannot read, naming it", async () => {
  const root = repo({}, { "package.json": "{ nope" });
  const result = await commitMsg(root, "chore: x\n");
  expect(result.code).toBe(1);
  expect(result.stderr).toMatch(/^repo commit-msg: package\.json: /);
});
