import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CONFIG_FILE } from "./config.ts";
import { main } from "./commit-msg.ts";
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
async function hook(root: string, message: string, result: RedProofResult = { ok: true, line: LINE }) {
  fs.writeFileSync(path.join(root, ".git", "COMMIT_EDITMSG"), message);
  const calls: { root: string; change: NameStatus[] }[] = [];
  const err: string[] = [];
  const redProof = (at: string, change: NameStatus[]) => (calls.push({ root: at, change }), result);
  const code = await main([".git/COMMIT_EDITMSG"], { cwd: root, stderr: (text) => err.push(text), redProof });
  return { calls, code, stderr: err.join("") };
}
const feat = (root: string) => hook(root, "feat: add x\n");
const SRC_AND_TEST = { "src/x.ts": "export const x = 1;\n", "src/x.test.ts": "t\n", "CHANGELOG.md": "# Changelog\n" };

describe("commit-msg red-proof in a public package", () => {
  it("refuses a feat with the problem in the refused list", async () => {
    const root = plant(PLAIN);
    stage(root, SRC_AND_TEST);
    const result = await hook(root, "feat: add x\n", { ok: false, problem: PROBLEM });
    expect(result.code).toBe(1);
    expect(result.stderr).toBe(`commit-msg: the message was refused\n  - ${PROBLEM}\n`);
    expect(result.calls).toStrictEqual([
      {
        root,
        change: [
          { status: "A", path: "CHANGELOG.md" },
          { status: "A", path: "src/x.test.ts" },
          { status: "A", path: "src/x.ts" },
        ],
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
    expect((await feat(root)).calls).toHaveLength(1);
  });

  it("does not count a fixture as source, so a private owner of the tests decides", async () => {
    const root = plant({ ...PLAIN, "package.json": PRIVATE });
    stage(root, { "fixtures/a.ts": "x\n", "x.test.ts": "t\n" });
    expect((await feat(root)).calls).toHaveLength(0);
  });
});

describe("commit-msg red-proof by package", () => {
  const mono = () =>
    plant({
      ...PLAIN,
      "package.json": { name: "mono", private: true, workspaces: ["packages/*"] },
      "packages/pub/package.json": { name: "pub" },
      "packages/priv/package.json": { name: "priv", private: true },
    });

  it("runs for a private package only with tdd: true", async () => {
    const root = mono();
    stage(root, { "packages/priv/x.ts": "x\n", "packages/priv/x.test.ts": "t\n" });
    expect((await hook(root, "fix(priv): x\n")).calls).toHaveLength(0);
    fs.writeFileSync(path.join(root, CONFIG_FILE), TDD);
    expect((await hook(root, "fix(priv): x\n")).calls).toHaveLength(1);
  });

  it("runs when any changed source file belongs to a public package", async () => {
    const root = mono();
    stage(root, { "packages/priv/x.ts": "x\n", "packages/pub/y.ts": "y\n", "packages/priv/x.test.ts": "t\n" });
    expect((await hook(root, "feat(pub): y\n")).calls).toHaveLength(1);
  });

  it("looks at the test files' owners only when no source file changed", async () => {
    const root = mono();
    stage(root, { "packages/pub/y.test.ts": "t\n", "packages/priv/x.test.ts": "t\n" });
    expect((await hook(root, "feat(pub): y\n")).calls).toHaveLength(1);
  });
});

describe("commit-msg red-proof in a single-package repo", () => {
  it("uses the root package.json of a single-package repo, private or not", async () => {
    const root = plant({ ...PLAIN, "package.json": PRIVATE });
    stage(root, SRC_AND_TEST);
    expect((await feat(root)).calls).toHaveLength(0);
    fs.writeFileSync(path.join(root, "package.json"), '{ "name": "p" }\n');
    expect((await feat(root)).calls).toHaveLength(1);
  });

  it("takes a repo with no workerstack.config.ts as tdd false, by its root package.json", async () => {
    const root = plant({ "package.json": PRIVATE });
    stage(root, SRC_AND_TEST);
    expect((await feat(root)).calls).toHaveLength(0);
    fs.writeFileSync(path.join(root, "package.json"), '{ "name": "p" }\n');
    expect((await feat(root)).calls).toHaveLength(1);
  });
});

describe("commit-msg red-proof never runs", () => {
  it.each(["test: cover x\n", "docs: x\n", "chore: x\n", "feat: Add x\n", "feat(Bad): x\n"])(
    "for the message %j: another type, or a header already refused",
    async (message) => {
      const root = plant({ [CONFIG_FILE]: TDD });
      stage(root, SRC_AND_TEST);
      expect((await hook(root, message)).calls).toStrictEqual([]);
    },
  );

  it("when the staged change has no test, which the message check refuses first", async () => {
    const root = plant({ [CONFIG_FILE]: TDD });
    stage(root, { "src/x.ts": "x\n" });
    const result = await feat(root);
    expect(result.calls).toStrictEqual([]);
    expect(result.code).toBe(1);
  });
});

describe("commit-msg red-proof end to end", () => {
  it("runs the real vitest on HEAD and lands a feat whose test fails there", async () => {
    const root = plant(PLAIN);
    stage(root, { "x.ts": "export const x = 1;\n", "x.test.ts": FAIL, "CHANGELOG.md": "# Changelog\n" });
    fs.writeFileSync(path.join(root, ".git", "COMMIT_EDITMSG"), "feat: add x\n");
    const err: string[] = [];
    expect(await main([".git/COMMIT_EDITMSG"], { cwd: root, stderr: (text) => err.push(text) })).toBe(0);
    expect(err.join("")).toBe("red-proof: 1 of 1 changed test files failed on HEAD\n");
  }, 60_000);
});
