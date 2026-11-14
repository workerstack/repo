import fs from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { lines } from "./__fixtures__/commit-repo.ts";
import { git, removePlanted, tempDir } from "./__fixtures__/planted-repo.ts";
import { NEEDS_X, plant, stage } from "./__fixtures__/red-proof-repo.ts";
import { main } from "./commit-msg.ts";

/** The commit-msg hook during `git commit --amend`: it judges the whole commit the amend makes. */
afterEach(removePlanted);

const PLAIN = { "repo.config.ts": "export default {}\n" };
const FEAT = { "CHANGELOG.md": "# Changelog\n\n- x\n", "x.test.ts": NEEDS_X, "x.ts": "export const x = () => 1;\n" };
const WHY = "The generator output lands with its source.";

/** How git runs the hook: for `git commit --amend`, or for a plain commit. */
type How = "amend" | "plain";

/** Files to write, path to text. */
type Files = Record<string, string>;

/** Runs the hook on `message` as git would for `how`; the exit code and stderr. */
async function hook(root: string, message: string, how: How) {
  const file = path.join(tempDir(), "message");
  fs.writeFileSync(file, message);
  const err: string[] = [];
  const code = await main([file], { amending: () => how === "amend", cwd: root, stderr: (text) => err.push(text) });

  return { code, stderr: err.join("") };
}

/** A repo whose HEAD is `subject` holding `files` on top of the planted base, with `more` staged. */
function amendable(subject: string, files: Files, more: Files): string {
  const root = plant(PLAIN);
  stage(root, files);
  git(root, "commit", "-q", "--no-verify", "-m", subject);
  stage(root, more);

  return root;
}

function featAmend(): string {
  return amendable("feat: add x", FEAT, { "x.ts": "export const x = () => 1;\nexport const y = 2;\n" });
}

function bigAmend(): string {
  return amendable("chore: x", { "big.txt": lines(900) }, { "more.txt": lines(200) });
}

describe("an amend is judged as the whole commit it makes", () => {
  it("so a feat amend keeps its test and CHANGELOG line, and red-proof runs against HEAD's parent", async () => {
    expect(await hook(featAmend(), "feat: add x\n", "amend")).toStrictEqual({
      code: 0,
      stderr: "red-proof: 1 of 1 changed test files failed on HEAD^\n",
    });
  });

  it("so an amend that takes the commit over the limit needs its why-line", async () => {
    const root = bigAmend();
    const bare = await hook(root, "chore: x\n", "amend");
    expect(bare.code).toBe(1);
    expect(bare.stderr).toContain("the commit changes 1100 lines, over the limit of 1000");
    expect(await hook(root, `chore: x\n\n${WHY}\n`, "amend")).toStrictEqual({ code: 0, stderr: "" });
  });

  it("and an amend of a root commit is judged against nothing, with red-proof skipped", async () => {
    const root = plant(PLAIN);
    stage(root, FEAT);
    expect(await hook(root, "feat: add x\n", "amend")).toStrictEqual({
      code: 0,
      stderr: "red-proof: skipped, no parent of HEAD to run against\n",
    });
  });
});

describe("a plain commit is judged on its staged lines", () => {
  it("so the same feat change is refused for its test and CHANGELOG line", async () => {
    const got = await hook(featAmend(), "feat: add x\n", "plain");
    expect(got.code).toBe(1);
    expect(got.stderr).toContain("a feat commit must include a test change");
    expect(got.stderr).toContain("a feat changes what users see");
  });

  it("so the same size change takes no why-line", async () => {
    const root = bigAmend();
    expect(await hook(root, "chore: x\n", "plain")).toStrictEqual({ code: 0, stderr: "" });
    const withWhy = await hook(root, `chore: x\n\n${WHY}\n`, "plain");
    expect(withWhy.code).toBe(1);
  });
});
