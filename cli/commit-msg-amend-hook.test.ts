import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { lines } from "./__fixtures__/commit-repo.ts";
import { git, removePlanted } from "./__fixtures__/planted-repo.ts";
import { plant, stage } from "./__fixtures__/red-proof-repo.ts";
import { childEnv } from "./env.ts";
import { toolEnv } from "./scripts/tool-env.ts";

/** A real `git commit` through a commit-msg hook that runs `repo commit-msg`, as the generated hook does. */
afterEach(removePlanted);

const REPO_BIN = path.resolve(import.meta.dirname, "..", "bin", "repo.ts");
const OVER = "the commit changes 1100 lines, over the limit of 1000";

/** A repo whose HEAD changes 900 lines, with 200 more staged and the hook installed. */
function hooked(): string {
  const root = plant({ "repo.config.ts": "export default {}\n" });
  stage(root, { "big.txt": lines(900) });
  git(root, "commit", "-q", "-m", "chore: x");
  stage(root, { "more.txt": lines(200) });
  const hook = path.join(root, ".git", "hooks", "commit-msg");
  fs.mkdirSync(path.dirname(hook), { recursive: true });
  fs.writeFileSync(hook, `#!/bin/sh\nexec bun ${JSON.stringify(REPO_BIN)} commit-msg "$1"\n`, { mode: 0o755 });

  return root;
}

/** Runs a real git commit in `root` with the repo's own hooks; its exit code and stderr. */
function commit(root: string, ...args: string[]) {
  const config = ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false"];
  const hooks = ["-c", "core.hooksPath=.git/hooks", "-c", "alias.ca=commit --amend"];
  const env = toolEnv(childEnv());
  const run = spawnSync("git", [...config, ...hooks, ...args], { cwd: root, encoding: "utf8", env });

  return { code: run.status, stderr: run.stderr };
}

describe.runIf(process.platform === "linux")("the real hook tells an amend from a plain commit", () => {
  it("judging `git commit --amend` as the whole commit", () => {
    const root = hooked();
    const got = commit(root, "commit", "--amend", "-m", "chore: x");
    expect(got.code).toBe(1);
    expect(got.stderr).toContain(OVER);
  });

  it("through an alias too", () => {
    const root = hooked();
    expect(commit(root, "ca", "-m", "chore: x").stderr).toContain(OVER);
    expect(commit(root, "ca", "-m", "chore: x", "-m", "The generator output lands with its source.").code).toBe(0);
  });

  it("judging a plain commit on its staged lines", () => {
    expect(commit(hooked(), "commit", "-m", "chore: y")).toStrictEqual({ code: 0, stderr: "" });
  });
});
