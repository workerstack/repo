import fs from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { main } from "./commit-msg.ts";
import { CONFIG_FILE } from "./config.constants.ts";
import { removePlanted } from "./fixtures/planted-repo.ts";
import { FAIL, plant, stage } from "./fixtures/red-proof-repo.ts";
import type { NameStatus, RedProofResult } from "./red-proof.ts";

/** The hook's red-proof step: when it runs, what it refuses, what it prints. */
afterEach(removePlanted);

const TDD = "export default { tdd: true }\n";
const PLAIN = { [CONFIG_FILE]: "export default {}\n" };
const PRIVATE = { name: "p", private: true };
const PROBLEM = "red-proof: no changed test file fails on HEAD's source (a.test.ts passed); needs a failing one";
const LINE = "red-proof: 1 of 1 changed test files failed on HEAD";

/** Runs `repo commit-msg` with a red-proof stand-in; what it was given, the exit code and stderr. */
async function hook(root: string, message: string, result: RedProofResult = { line: LINE, ok: true }) {
  fs.writeFileSync(path.join(root, ".git", "COMMIT_EDITMSG"), message);
  const calls: { root: string; change: NameStatus[] }[] = [];
  const err: string[] = [];
  function redProof(at: string, change: NameStatus[]) {
    return (calls.push({ change, root: at }), result);
  }
  const code = await main([".git/COMMIT_EDITMSG"], { cwd: root, redProof, stderr: (text) => err.push(text) });
  return { calls, code, stderr: err.join("") };
}
async function callsOf(root: string, message: string) {
  const result = await hook(root, message);
  return result.calls;
}
function featCalls(root: string) {
  return callsOf(root, "feat: add x\n");
}
/** How often red-proof ran for a feat while the root package was private, then once it was public. */
async function callCountsAcrossPublic(root: string) {
  const before = await featCalls(root);
  fs.writeFileSync(path.join(root, "package.json"), '{ "name": "p" }\n');
  const after = await featCalls(root);
  return { after: after.length, before: before.length };
}
function mono() {
  return plant({
    ...PLAIN,
    "package.json": { name: "mono", private: true, workspaces: ["packages/*"] },
    "packages/priv/package.json": { name: "priv", private: true },
    "packages/pub/package.json": { name: "pub" },
  });
}
const SRC_AND_TEST = { "CHANGELOG.md": "# Changelog\n", "src/x.test.ts": "t\n", "src/x.ts": "export const x = 1;\n" };

describe("commit-msg red-proof in a public package", () => {
  it("refuses a feat with the problem in the refused list", async () => {
    const root = plant(PLAIN);
    stage(root, SRC_AND_TEST);
    const result = await hook(root, "feat: add x\n", { ok: false, problem: PROBLEM });
    expect(result.code).toBe(1);
    expect(result.stderr).toBe(`commit-msg: the message was refused\n  - ${PROBLEM}\n`);
    expect(result.calls).toStrictEqual([
      {
        change: [
          { path: "CHANGELOG.md", status: "A" },
          { path: "src/x.test.ts", status: "A" },
          { path: "src/x.ts", status: "A" },
        ],
        root,
      },
    ]);
  });

  it("lets a fix through and prints the red-proof line", async () => {
    const root = plant(PLAIN);
    stage(root, SRC_AND_TEST);
    expect(await hook(root, "fix: handle x\n")).toMatchObject({ code: 0, stderr: `${LINE}\n` });
  });
});

describe("commit-msg red-proof in a test-only change", () => {
  it("runs from a test-only change, using the test files' owner", async () => {
    const root = plant(PLAIN);
    stage(root, { "x.test.ts": "t\n" });
    expect(await featCalls(root)).toHaveLength(1);
  });

  it("does not count a fixture as source, so a private owner of the tests decides", async () => {
    const root = plant({ ...PLAIN, "package.json": PRIVATE });
    stage(root, { "fixtures/a.ts": "x\n", "x.test.ts": "t\n" });
    expect(await featCalls(root)).toHaveLength(0);
  });
});

describe("commit-msg red-proof by package", () => {
  it("runs for a private package only with tdd: true", async () => {
    const root = mono();
    stage(root, { "packages/priv/x.test.ts": "t\n", "packages/priv/x.ts": "x\n" });
    expect(await callsOf(root, "fix(priv): x\n")).toHaveLength(0);
    fs.writeFileSync(path.join(root, CONFIG_FILE), TDD);
    expect(await callsOf(root, "fix(priv): x\n")).toHaveLength(1);
  });

  it("runs when any changed source file belongs to a public package", async () => {
    const root = mono();
    stage(root, { "packages/priv/x.test.ts": "t\n", "packages/priv/x.ts": "x\n", "packages/pub/y.ts": "y\n" });
    expect(await callsOf(root, "feat(pub): y\n")).toHaveLength(1);
  });

  it("looks at the test files' owners only when no source file changed", async () => {
    const root = mono();
    stage(root, { "packages/priv/x.test.ts": "t\n", "packages/pub/y.test.ts": "t\n" });
    expect(await callsOf(root, "feat(pub): y\n")).toHaveLength(1);
  });
});

describe("commit-msg red-proof in a single-package repo", () => {
  it("uses the root package.json of a single-package repo, private or not", async () => {
    const root = plant({ ...PLAIN, "package.json": PRIVATE });
    stage(root, SRC_AND_TEST);
    expect(await callCountsAcrossPublic(root)).toStrictEqual({ after: 1, before: 0 });
  });

  it("takes a repo with no workerstack.config.ts as tdd false, by its root package.json", async () => {
    const root = plant({ "package.json": PRIVATE });
    stage(root, SRC_AND_TEST);
    expect(await callCountsAcrossPublic(root)).toStrictEqual({ after: 1, before: 0 });
  });
});

describe("commit-msg red-proof never runs", () => {
  it.each(["test: cover x\n", "docs: x\n", "chore: x\n", "feat: Add x\n", "feat(Bad): x\n"])(
    "for the message %j: another type, or a header already refused",
    async (message) => {
      const root = plant({ [CONFIG_FILE]: TDD });
      stage(root, SRC_AND_TEST);
      expect(await callsOf(root, message)).toStrictEqual([]);
    },
  );

  it("when the staged change has no test, which the message check refuses first", async () => {
    const root = plant({ [CONFIG_FILE]: TDD });
    stage(root, { "src/x.ts": "x\n" });
    const result = await hook(root, "feat: add x\n");
    expect(result.calls).toStrictEqual([]);
    expect(result.code).toBe(1);
  });
});

describe("commit-msg red-proof end to end", () => {
  it("runs the real vitest on HEAD and lands a feat whose test fails there", async () => {
    const root = plant(PLAIN);
    stage(root, { "CHANGELOG.md": "# Changelog\n", "x.test.ts": FAIL, "x.ts": "export const x = 1;\n" });
    fs.writeFileSync(path.join(root, ".git", "COMMIT_EDITMSG"), "feat: add x\n");
    const err: string[] = [];
    expect(await main([".git/COMMIT_EDITMSG"], { cwd: root, stderr: (text) => err.push(text) })).toBe(0);
    expect(err.join("")).toBe("red-proof: 1 of 1 changed test files failed on HEAD\n");
  }, 60_000);
});
