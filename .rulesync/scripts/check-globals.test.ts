import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { checkGlobals } from "./check-globals.mjs";
import { syncGlobals } from "./sync-global-settings.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");
const script = path.join(here, "check-globals.mjs");

const tmpDirs: string[] = [];
afterEach(() => {
  for (const d of tmpDirs.splice(0)) {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

function tmpDir(prefix: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpDirs.push(dir);
  return dir;
}

function writeProjectConfig(ws: string, body: string) {
  const dest = path.join(ws, ".grok/config.toml");
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, body);
}

const PROJECT_OK = `[plugins]
enabled = []

[permission]
deny = [ "MCPTool" ]
`;

describe("checkGlobals", () => {
  it("missing home config exits 1 with apply hint", () => {
    const home = tmpDir("check-globals-missing-");
    const ws = tmpDir("check-globals-ws-");
    writeProjectConfig(ws, PROJECT_OK);
    const r = checkGlobals({ home, workspaceRoot: ws });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/sync:globals:apply/);
    const cli = spawnSync(process.execPath, [script], {
      encoding: "utf8",
      cwd: ws,
      timeout: 20_000,
      env: { ...process.env, HOME: home },
    });
    expect(cli.status).toBe(1);
    expect(cli.stderr).toMatch(/sync:globals:apply/);
  });

  it("missing keys exit 1", () => {
    const home = tmpDir("check-globals-keys-");
    const ws = tmpDir("check-globals-ws-keys-");
    writeProjectConfig(ws, PROJECT_OK);
    fs.mkdirSync(path.join(home, ".grok"), { recursive: true });
    fs.writeFileSync(path.join(home, ".grok/config.toml"), "[agent]\nname = \"router\"\n");
    const r = checkGlobals({ home, workspaceRoot: ws });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/orchestrator/);
    expect(r.error).toMatch(/sync:globals:apply/);
  });

  it("apply then check 0", () => {
    const home = tmpDir("check-globals-apply-");
    const ws = tmpDir("check-globals-ws-apply-");
    writeProjectConfig(ws, PROJECT_OK);
    const synced = syncGlobals({
      workspaceRoot: repoRoot,
      home,
      apply: true,
      host: "grok",
    });
    expect(synced.ok).toBe(true);
    const r = checkGlobals({ home, workspaceRoot: ws });
    expect(r.ok).toBe(true);
    const cli = spawnSync(process.execPath, [script], {
      encoding: "utf8",
      cwd: ws,
      timeout: 20_000,
      env: { ...process.env, HOME: home },
    });
    expect(cli.status).toBe(0);
  });

  it("home workspace may set [features] and [agent] on the same file", () => {
    const home = tmpDir("check-globals-home-ws-");
    const synced = syncGlobals({
      workspaceRoot: repoRoot,
      home,
      apply: true,
      host: "grok",
    });
    expect(synced.ok).toBe(true);
    writeProjectConfig(home, `${PROJECT_OK}
[agent]
name = "orchestrator"

[features]
two_pass_compaction = true
`);
    const r = checkGlobals({ home, workspaceRoot: home });
    expect(r.ok).toBe(true);
  });

  it("project config with [features] fails", () => {
    const home = tmpDir("check-globals-feat-");
    const ws = tmpDir("check-globals-ws-feat-");
    const synced = syncGlobals({
      workspaceRoot: repoRoot,
      home,
      apply: true,
      host: "grok",
    });
    expect(synced.ok).toBe(true);
    writeProjectConfig(ws, `${PROJECT_OK}\n[features]\ntwo_pass_compaction = true\n`);
    const r = checkGlobals({ home, workspaceRoot: ws });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/\[features\]/);
  });

  it("does not write real HOME", () => {
    expect(tmpDirs.every((d) => d !== os.homedir() && !d.startsWith(os.homedir() + path.sep))).toBe(
      true,
    );
  });
});
