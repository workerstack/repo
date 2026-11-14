import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { expect, it } from "vitest";

import { useTempDirs } from "../cli/__fixtures__/temp-dirs.ts";
import { testEnv } from "./test-env.ts";

const AUTOCRLF = path.join(import.meta.dirname, "autocrlf.gitconfig");
const { tempDir } = useTempDirs("crlf-");

/** An env a host hands the tests: repo pointers, project dirs, env config, and global and system config files. */
const HOST_ENV: NodeJS.ProcessEnv = {
  CLAUDE_PROJECT_DIR: "/host/project",
  GIT_CONFIG_COUNT: "1",
  GIT_CONFIG_GLOBAL: "/home/dev/.gitconfig-work",
  GIT_CONFIG_KEY_0: "user.name",
  GIT_CONFIG_SYSTEM: "/etc/other-gitconfig",
  GIT_CONFIG_VALUE_0: "someone",
  GIT_DIR: "/real/repo/.git",
  GIT_INDEX_FILE: "/real/repo/.git/index",
  GIT_WORK_TREE: "/real/repo",
  GROK_WORKSPACE_ROOT: "/host/workspace",
  PATH: "/usr/bin",
};

/** Runs git in `dir` with the env the test setup gave this process. */
function git(dir: string, ...args: string[]): string {
  return spawnSync("git", args, { cwd: dir, encoding: "utf8" }).stdout;
}

it("drops git's repo pointers and the host's project dirs, keeps env config, and adds the quiet git keys", () => {
  const env = testEnv(HOST_ENV, "linux");

  expect(env).toStrictEqual({
    BUN_RUNTIME_TRANSPILER_CACHE_PATH: path.join(os.homedir(), ".bun", "install", "cache", "@t@"),
    GIT_CONFIG_COUNT: "4",
    GIT_CONFIG_KEY_0: "user.name",
    GIT_CONFIG_KEY_1: "maintenance.auto",
    GIT_CONFIG_KEY_2: "gc.auto",
    GIT_CONFIG_KEY_3: "core.fsmonitor",
    GIT_CONFIG_SYSTEM: AUTOCRLF,
    GIT_CONFIG_VALUE_0: "someone",
    GIT_CONFIG_VALUE_1: "false",
    GIT_CONFIG_VALUE_2: "0",
    GIT_CONFIG_VALUE_3: "false",
    PATH: "/usr/bin",
  });
});

it("keeps a bun cache path the env already names", () => {
  expect(testEnv({ BUN_RUNTIME_TRANSPILER_CACHE_PATH: "/cache" }).BUN_RUNTIME_TRANSPILER_CACHE_PATH).toBe("/cache");
});

it("leaves git's system config alone on Windows, whose runner sets core.autocrlf itself", () => {
  expect(testEnv({ GIT_CONFIG_SYSTEM: "C:\\git\\etc\\gitconfig" }, "win32").GIT_CONFIG_SYSTEM).toBeUndefined();
  expect(testEnv({}, "darwin").GIT_CONFIG_SYSTEM).toBe(AUTOCRLF);
});

it.skipIf(process.platform === "win32")("checks files out with CRLF in a repo a test makes, as on Windows", () => {
  const dir = tempDir();

  expect(git(dir, "config", "--system", "core.autocrlf")).toBe("true\n");
  git(dir, "init", "-q");
  fs.writeFileSync(path.join(dir, "a.txt"), "x\ny\n");
  git(dir, "add", "a.txt");
  git(dir, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "a");
  fs.rmSync(path.join(dir, "a.txt"));
  git(dir, "checkout", "--", "a.txt");
  expect(fs.readFileSync(path.join(dir, "a.txt"), "utf8")).toBe("x\r\ny\r\n");
});
