import fs from "node:fs";
import os from "node:os";

// Host shells export project dirs; tests and the CLIs they spawn must resolve their own temp roots.
for (const key of ["CLAUDE_PROJECT_DIR", "GROK_WORKSPACE_ROOT", "GEMINI_PROJECT_DIR"]) delete process.env[key];

// git prints long names, and `os.tmpdir()` may be an 8.3 short name (C:\Users\RUNNER~1); temp roots built by
// tests use git's spelling. dev/test-paths.ts `aliasOf` covers the other spellings on purpose.
if (process.platform === "win32") {
  const long = fs.realpathSync.native(os.tmpdir());
  process.env.TEMP = long;
  process.env.TMP = long;
}
