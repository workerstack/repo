import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach } from "vitest";

// Host shells export project dirs; tests and the CLIs they spawn must resolve their own temp roots.
for (const key of ["CLAUDE_PROJECT_DIR", "GROK_WORKSPACE_ROOT"]) delete process.env[key];

// bun keeps its transpiler cache under $HOME/.bun unless XDG_CACHE_HOME is set (CI sets neither), so a spawned
// bun would leave files in every fake HOME a test hands it. Pin the cache under the real home instead.
process.env.BUN_RUNTIME_TRANSPILER_CACHE_PATH ??= path.join(os.homedir(), ".bun", "install", "cache", "@t@");

// git prints long names, and `os.tmpdir()` may be an 8.3 short name (C:\Users\RUNNER~1); temp roots built by
// tests use git's spelling. dev/test-paths.ts `aliasOf` covers the other spellings on purpose.
if (process.platform === "win32") {
  const long = fs.realpathSync.native(os.tmpdir());
  process.env.TEMP = long;
  process.env.TMP = long;
}

// vitest's worker RPC times out after a fixed 60s, and its replies land only when the event loop turns. Hook
// tests block it with spawnSync for minutes per file on Windows, so give the loop one turn after every test.
afterEach(() => new Promise<void>((resolve) => setImmediate(resolve)));
