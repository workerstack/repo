import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { expect, it } from "vitest";

import { BASE_CONFIG } from "../__fixtures__/base-config.ts";
import { AGENT_DEFAULTS } from "../agent-defaults.constants.ts";
import { repoEnv } from "../repo-env.ts";
import { tempDir as makeTempDir, useTempDirs } from "./__fixtures__/temp-dirs.ts";
import type { Output, SyncContext } from "./outputs.ts";
import { runGit, standards } from "./standards.ts";

/** The git hooks the standards pass plans, and the git runner behind `core.hooksPath`. */
useTempDirs();

function tempDir(): string {
  return fs.realpathSync(makeTempDir("workerstack-githook-"));
}

function context(packs: SyncContext["config"]["packs"], read: SyncContext["read"] = () => null): SyncContext {
  return {
    config: {
      agents: { ...AGENT_DEFAULTS, hosts: [], skills: [] },
      packs,
      ...BASE_CONFIG,
    },
    read,
    root: "/repo",
    workspace: { manifest: { name: "app" }, packages: [], root: "/repo" },
  };
}

function hooks(ctx: SyncContext): Output[] {
  return standards(ctx, []).outputs.filter((output) => output.path.startsWith(".githooks/"));
}

/** A fake bin that prints its arguments. */
const ECHO_BIN = '#!/bin/sh\necho "repo $@"\n';

/** A fake bin that prints its arguments and the stdin it got, and fails `link` when `fail-link` exists. */
const STDIN_BIN = '#!/bin/sh\necho "repo $@ <$(cat)>"\n[ "$1" = link ] && [ -e fail-link ] && exit 1\nexit 0\n';

/** Runs a planned hook with `sh` at a top level that holds a fake bin, the way git runs it, with an agent env set. */
function runHook(name: string, ...args: string[]) {
  return runHookWith({ bin: ECHO_BIN, input: "" }, name, ...args);
}

/** `runHook` with the fake bin `how.bin` and `how.input` on stdin; `how.failLink` makes the bin's `link` fail. */
function runHookWith(how: { bin: string; input: string; failLink?: boolean }, name: string, ...args: string[]) {
  const root = tempDir();
  fs.mkdirSync(path.join(root, "node_modules", ".bin"), { recursive: true });
  fs.writeFileSync(path.join(root, "node_modules", ".bin", "repo"), how.bin, { mode: 0o755 });

  if (how.failLink === true) fs.writeFileSync(path.join(root, "fail-link"), "");
  const hook = hooks(context(["standards"])).find((output) => output.path === `.githooks/${name}`);

  if (hook?.kind !== "file") throw new Error(`no hook ${name}`);
  fs.writeFileSync(path.join(root, "hook"), hook.content);
  const env = { CLAUDE_PROJECT_DIR: "/nowhere", PATH: repoEnv.process.PATH };

  return spawnSync("sh", ["hook", ...args], { cwd: root, encoding: "utf8", env, input: how.input });
}

it("plans pre-commit, commit-msg and pre-push as tracked, executable files sync owns, none without the pack", () => {
  const planned = hooks(context(["standards"])).map((output) => ({
    executable: output.kind === "file" && output.executable === true,
    managed: output.managed,
    path: output.path,
    tracked: output.tracked,
  }));

  expect(planned).toStrictEqual([
    { executable: true, managed: "whole", path: ".githooks/commit-msg", tracked: true },
    { executable: true, managed: "whole", path: ".githooks/pre-commit", tracked: true },
    { executable: true, managed: "whole", path: ".githooks/pre-push", tracked: true },
  ]);
  expect(hooks(context(["agents", "docs"]))).toStrictEqual([]);
});

it("pre-commit runs repo turn --staged from the bin of the checkout git runs it in", () => {
  const r = runHook("pre-commit");
  expect(r.stderr).toBe("");
  expect(r.stdout).toBe("repo turn --staged\n");
});

it("commit-msg runs repo commit-msg on the message file git passes", () => {
  expect(runHook("commit-msg", ".git/COMMIT_EDITMSG").stdout).toBe("repo commit-msg .git/COMMIT_EDITMSG\n");
});

it("pre-push runs link with no stdin, then feeds git's ref lines to commit-msg --pre-push", () => {
  const input = "refs/heads/a 1111 refs/heads/a 0000\nrefs/heads/b 2222 refs/heads/b 3333\n";
  const r = runHookWith({ bin: STDIN_BIN, input }, "pre-push", "origin", "git@example.com:a/b.git");
  expect(r.stderr).toBe("");
  expect(r.status).toBe(0);
  expect(r.stdout).toBe(
    "repo link --pre-push <>\n" +
      "repo commit-msg --pre-push origin git@example.com:a/b.git <refs/heads/a 1111 refs/heads/a 0000\n" +
      "refs/heads/b 2222 refs/heads/b 3333>\n",
  );
});

it("pre-push stops when link refuses, before checking commits", () => {
  const how = { bin: STDIN_BIN, failLink: true, input: "refs/heads/a 1111 refs/heads/a 0000\n" };
  const r = runHookWith(how, "pre-push", "origin", "url");
  expect(r.status).toBe(1);
  expect(r.stdout).toBe("repo link --pre-push <>\n");
});

function at(text: string) {
  return (rel: string) => (rel === ".githooks/pre-commit" ? text : null);
}

it("refuses a hand-written hook at either path, and replaces one it generated", () => {
  expect(standards(context(["standards"], at("#!/bin/sh\nnpx lint-staged\n")), [])).toStrictEqual({
    errors: [".githooks/pre-commit is hand-written; delete it so repo sync can own it"],
    outputs: [],
  });

  for (const header of ["# @generated by @workerstack/repo", "# Generated by repo sync. Do not edit."]) {
    const generated = at(`#!/bin/sh\n${header}\nold\n`);
    expect(standards(context(["standards"], generated), []).errors).toStrictEqual([]);
  }
});

it("runGit returns git's output, or a null status with the reason when git cannot start", () => {
  const root = tempDir();
  const version = runGit(root, ["--version"]);
  expect(version.status).toBe(0);
  expect(version.stdout).toMatch(/^git version /);
  expect(runGit(root, ["hash-object", "--stdin"], "x").stdout).toBe("c1b0730e0133447badcfd47fd144e254807b06e1\n");
  const missing = runGit(path.join(root, "missing"), ["--version"]);
  expect(missing).toMatchObject({ status: null, stdout: "" });
  expect(missing.stderr).toMatch(/ENOENT/);
});
