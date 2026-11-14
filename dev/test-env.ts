import os from "node:os";
import path from "node:path";

import { toolEnv } from "../cli/scripts/tool-env.ts";
import {
  BUN_CACHE_VAR,
  GIT_CONFIG_COUNT,
  GIT_CONFIG_KEY,
  GIT_CONFIG_VALUE,
  HOST_PROJECT_VARS,
  QUIET_GIT,
} from "./vitest-setup.constants.ts";

/**
 * The env every test process runs with, from the one it inherited.
 *
 * Host shells export project dirs, and a git hook hands its tools GIT_DIR, GIT_INDEX_FILE and the rest; a test that
 * kept either would aim its own temp repo, or the CLIs it spawns, at the real checkout. Both go; git's env config
 * stays.
 *
 * bun keeps its transpiler cache under $HOME/.bun unless XDG_CACHE_HOME is set (CI sets neither), so a spawned bun
 * would leave files in every fake HOME a test hands it. The cache is pinned under the real home instead.
 *
 * Recent git also starts `maintenance run --auto --detach` (and `gc --auto --detach`) after a commit or rebase; that
 * child outlives the test and races the recursive removal of its temp dir. Env config reaches every git a test or a
 * spawned CLI runs, whatever repo it makes; it is appended to any count already present.
 */
export function testEnv(inherited: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env = toolEnv(inherited);

  for (const key of HOST_PROJECT_VARS) delete env[key];
  const start = Number(env[GIT_CONFIG_COUNT] ?? 0);
  env[BUN_CACHE_VAR] = env[BUN_CACHE_VAR] ?? path.join(os.homedir(), ".bun", "install", "cache", "@t@");
  env[GIT_CONFIG_COUNT] = String(start + QUIET_GIT.length);

  for (const [i, [key, value]] of QUIET_GIT.entries()) {
    env[`${GIT_CONFIG_KEY}${start + i}`] = key;
    env[`${GIT_CONFIG_VALUE}${start + i}`] = value;
  }

  return env;
}
