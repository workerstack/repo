import fs from "node:fs";
import os from "node:os";

import { afterEach } from "vitest";

import { WINDOWS_PLATFORM } from "../cli/actionlint.constants.ts";
import { testEnv } from "./test-env.ts";

// The inherited env minus what would aim a test at the real checkout, plus the quiet git config (see testEnv).
const env = testEnv(process.env);

for (const key of Object.keys(process.env)) if (!Object.hasOwn(env, key)) delete process.env[key];

Object.assign(process.env, env);

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
