import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach } from "vitest";

import { WINDOWS_PLATFORM } from "../cli/actionlint.constants.ts";
import {
  BUN_CACHE_VAR,
  GIT_CONFIG_COUNT,
  GIT_CONFIG_KEY,
  GIT_CONFIG_VALUE,
  QUIET_GIT,
} from "./vitest-setup.constants.ts";

// Host shells export project dirs; tests and the CLIs they spawn must resolve their own temp roots.
for (const key of ["CLAUDE_PROJECT_DIR", "GROK_WORKSPACE_ROOT"]) delete process.env[key];

// bun keeps its transpiler cache under $HOME/.bun unless XDG_CACHE_HOME is set (CI sets neither), so a spawned
// bun would leave files in every fake HOME a test hands it. Pin the cache under the real home instead.
//
// Recent git also starts `maintenance run --auto --detach` (and `gc --auto --detach`) after a commit or rebase; that
// child outlives the test and races the recursive removal of its temp dir. Env config reaches every git a test or a
// spawned CLI runs, whatever repo it makes; it is appended to any count already present.
function testEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  const start = Number(env[GIT_CONFIG_COUNT] ?? 0);
  const out: Record<string, string> = {
    [BUN_CACHE_VAR]: env[BUN_CACHE_VAR] ?? path.join(os.homedir(), ".bun", "install", "cache", "@t@"),
    [GIT_CONFIG_COUNT]: String(start + QUIET_GIT.length),
  };
  QUIET_GIT.forEach(([key, value], i) => {
    out[`${GIT_CONFIG_KEY}${start + i}`] = key;
    out[`${GIT_CONFIG_VALUE}${start + i}`] = value;
  });
  return out;
}
Object.assign(process.env, testEnv(process.env));

// git prints long names, and `os.tmpdir()` may be an 8.3 short name (C:\Users\RUNNER~1); temp roots built by
// tests use git's spelling. dev/test-paths.ts `aliasOf` covers the other spellings on purpose.
if (process.platform === WINDOWS_PLATFORM) {
  const long = fs.realpathSync.native(os.tmpdir());
  process.env.TEMP = long;
  process.env.TMP = long;
}

// vitest's worker RPC times out after a fixed 60s, and its replies land only when the event loop turns. Hook
// tests block it with spawnSync for minutes per file on Windows, so give the loop one turn after every test.
afterEach(() => new Promise<void>((resolve) => setImmediate(resolve)));
