import os from "node:os";
import path from "node:path";

import { expect, it } from "vitest";

import { testEnv } from "./test-env.ts";

it("drops git's repo pointers and the host's project dirs, keeps env config, and adds the quiet git keys", () => {
  const env = testEnv({
    CLAUDE_PROJECT_DIR: "/host/project",
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: "user.name",
    GIT_CONFIG_VALUE_0: "someone",
    GIT_DIR: "/real/repo/.git",
    GIT_INDEX_FILE: "/real/repo/.git/index",
    GIT_WORK_TREE: "/real/repo",
    GROK_WORKSPACE_ROOT: "/host/workspace",
    PATH: "/usr/bin",
  });

  expect(env).toStrictEqual({
    BUN_RUNTIME_TRANSPILER_CACHE_PATH: path.join(os.homedir(), ".bun", "install", "cache", "@t@"),
    GIT_CONFIG_COUNT: "4",
    GIT_CONFIG_KEY_0: "user.name",
    GIT_CONFIG_KEY_1: "maintenance.auto",
    GIT_CONFIG_KEY_2: "gc.auto",
    GIT_CONFIG_KEY_3: "core.fsmonitor",
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
