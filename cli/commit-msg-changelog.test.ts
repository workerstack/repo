import fs from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { git, removePlanted, tempDir } from "./__fixtures__/planted-repo.ts";
import { plant, stage } from "./__fixtures__/red-proof-repo.ts";
import { main } from "./commit-msg.ts";

/** The hook's changelog rule: which commits must stage an entry, and for which package. */
afterEach(removePlanted);

const PLAIN = { "workerstack.config.ts": "export default {}\n" };
const SRC = { "src/x.test.ts": "t\n", "src/x.ts": "export const x = 1;\n" };
const PRIVATE = { ...PLAIN, "package.json": { name: "p", private: true } };

const MONO = {
  ...PLAIN,
  "package.json": { name: "mono", private: true, workspaces: ["packages/*"] },
  "packages/pub/package.json": { name: "pub" },
};

function refusal(what: string, file = "CHANGELOG.md") {
  const add = `add an entry under ## [Unreleased] in ${file} and stage it`;

  return `commit-msg: the message was refused\n  - ${what} changes what users see; ${add}\n`;
}

function redProof() {
  return { line: "red-proof: ok", ok: true as const };
}

/** Runs the hook on `message` (or on `range`) with the staged change as is; red-proof passes. */
async function hook(root: string, message: string, range?: string) {
  const file = path.join(tempDir(), "message");
  fs.writeFileSync(file, message);
  const err: string[] = [];
  const argv = range === undefined ? [file] : ["--range", range];
  const code = await main(argv, { cwd: root, redProof, stderr: (text) => err.push(text) });

  return { code, stderr: err.join("") };
}

async function codeOf(root: string, message: string) {
  const got = await hook(root, message);

  return got.code;
}

describe("the commit-msg hook asks for a changelog entry", () => {
  it.each([
    ["feat: add x\n", "a feat"],
    ["fix: handle x\n", "a fix"],
    ["perf: speed x\n", "a perf"],
    ["feat(cli)!: drop x\n", "a breaking change"],
    ["refactor: move x\n\nBREAKING CHANGE: x moved\n", "a breaking change"],
  ])("for %j in a public package", async (message, what) => {
    const root = plant(PLAIN);
    stage(root, SRC);
    expect(await hook(root, message)).toStrictEqual({ code: 1, stderr: refusal(what) });
  });

  it("only after the header itself is right", async () => {
    const root = plant(PLAIN);
    stage(root, SRC);
    const got = await hook(root, "added stuff\n");
    expect(got.stderr).not.toContain("CHANGELOG.md");
    expect(got.code).toBe(1);
  });

  it("in the public package that changed, by path", async () => {
    const root = plant(MONO);
    stage(root, { "packages/pub/x.test.ts": "t\n", "packages/pub/x.ts": "x\n" });
    const got = await hook(root, "feat(pub): add x\n");
    expect(got).toStrictEqual({ code: 1, stderr: refusal("a feat", "packages/pub/CHANGELOG.md") });
  });
});

describe("the commit-msg hook lets a commit through", () => {
  it("once the package's CHANGELOG.md is staged", async () => {
    const root = plant(MONO);
    stage(root, { "packages/pub/CHANGELOG.md": "# C\n", "packages/pub/x.test.ts": "t\n", "packages/pub/x.ts": "x\n" });
    expect(await hook(root, "feat(pub): add x\n")).toStrictEqual({ code: 0, stderr: "red-proof: ok\n" });
  });

  it.each(["chore: x\n", "docs: x\n", "test: x\n"])("for the type of %j", async (message) => {
    const root = plant(PLAIN);
    stage(root, SRC);
    expect(await codeOf(root, message)).toBe(0);
  });

  it("for a merge message, which has no type", async () => {
    const root = plant(PLAIN);
    stage(root, SRC);
    expect(await codeOf(root, "Merge branch 'x'\n")).toBe(0);
  });

  it("for a feat in a private package", async () => {
    const root = plant(PRIVATE);
    stage(root, SRC);
    expect(await codeOf(root, "feat: add x\n")).toBe(0);
  });

  it("over --range, which CI runs over commits that carry no entry", async () => {
    const root = plant(PLAIN);
    stage(root, SRC);
    git(root, "commit", "-q", "-m", "feat: add x");
    expect(await hook(root, "", "HEAD~1..HEAD")).toStrictEqual({ code: 0, stderr: "" });
  });
});
