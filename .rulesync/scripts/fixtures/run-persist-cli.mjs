import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Runs a persist CLI the way a host without the hook does: relative --workspace from the caller's cwd.
export function runPersistCli(script, body) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "persist-cli-"));
  const ws = path.join(cwd, "ws");
  fs.mkdirSync(ws);
  const r = spawnSync(process.execPath, [path.join(scriptsDir, script), "--workspace", "ws"], {
    cwd,
    input: body,
    encoding: "utf8",
  });
  return { cwd, ws, status: r.status, stderr: r.stderr, json: r.status === 0 ? JSON.parse(r.stdout) : null };
}
