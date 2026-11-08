import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { checkGlobals, driftLine } from "./check-globals.ts";
import { syncGlobals } from "./sync-global-settings.ts";
import { BUN } from "../../dev/test-paths";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");
const script = path.join(here, "check-globals.ts");
const HINT = "run `bun repo sync-globals --apply`";

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

const PROJECT_OK = `[plugins]
enabled = []

[permission]
deny = [ "MCPTool" ]
`;

/** Workspace holding the real manifest and payloads plus a clean project grok config. */
function tmpWorkspace(projectConfig: string | null = PROJECT_OK) {
  const ws = tmpDir("check-globals-ws-");
  fs.cpSync(
    path.join(repoRoot, ".rulesync/global-settings"),
    path.join(ws, ".rulesync/global-settings"),
    { recursive: true },
  );
  if (projectConfig !== null) {
    fs.mkdirSync(path.join(ws, ".grok"), { recursive: true });
    fs.writeFileSync(path.join(ws, ".grok/config.toml"), projectConfig);
  }
  return ws;
}

function syncedHome(ws: string) {
  const home = tmpDir("check-globals-home-");
  expect(syncGlobals({ workspaceRoot: ws, home, apply: true }).ok).toBe(true);
  return home;
}

function runCli(cwd: string, home: string) {
  return spawnSync(BUN, [script], {
    encoding: "utf8",
    cwd,
    timeout: 20_000,
    env: { ...process.env, HOME: home },
  });
}

/** The settings keys the cases below edit. */
interface SettingsJson {
  approvalMode?: string;
  permissions: { defaultMode?: string; token?: string };
  extra?: boolean;
  apiKey?: string;
  hooks?: unknown;
}

function editJson(file: string, edit: (v: SettingsJson) => void) {
  const v = JSON.parse(fs.readFileSync(file, "utf8")) as SettingsJson;
  edit(v);
  fs.writeFileSync(file, JSON.stringify(v));
}

describe("checkGlobals", () => {
  it("passes when every payload key is present in its dest", () => {
    const ws = tmpWorkspace();
    const home = syncedHome(ws);
    expect(checkGlobals({ home, workspaceRoot: ws })).toEqual({ ok: true, drift: [] });
    const cli = runCli(ws, home);
    expect(cli.status).toBe(0);
    expect(cli.stderr).toBe("");
  });

  it("a dest missing one payload key returns that drift and the CLI prints the apply hint", () => {
    const ws = tmpWorkspace();
    const home = syncedHome(ws);
    editJson(path.join(home, ".cursor/cli-config.json"), (v) => {
      delete v.approvalMode;
    });
    const r = checkGlobals({ home, workspaceRoot: ws });
    expect(r.ok).toBe(false);
    expect(r.drift).toEqual([
      { host: "cursor", dest: ".cursor/cli-config.json", key: "approvalMode" },
    ]);
    const cli = runCli(ws, home);
    expect(cli.status).toBe(1);
    expect(cli.stderr.trim()).toBe(
      `drift: cursor .cursor/cli-config.json approvalMode; ${HINT}`,
    );
  });

  it("a wrong nested value drifts with a dotted key", () => {
    const ws = tmpWorkspace();
    const home = syncedHome(ws);
    editJson(path.join(home, ".claude/settings.json"), (v) => {
      v.permissions.defaultMode = "default";
      v.extra = true;
    });
    const r = checkGlobals({ home, workspaceRoot: ws });
    expect(r.drift).toEqual([
      { host: "claude", dest: ".claude/settings.json", key: "permissions.defaultMode" },
    ]);
  });

  it("a toml dest with a changed table value drifts", () => {
    const ws = tmpWorkspace();
    const home = syncedHome(ws);
    fs.writeFileSync(path.join(home, ".codex/config.toml"), 'approval_policy = "on-request"\n');
    const r = checkGlobals({ home, workspaceRoot: ws });
    expect(r.drift?.map((d: { key: string }) => d.key)).toEqual([
      "approval_policy",
      "sandbox_mode",
    ]);
    expect(driftLine(r.drift![0]!)).toBe(
      `drift: codex .codex/config.toml approval_policy; ${HINT}`,
    );
  });

  it("array payload values compare by deep equality", () => {
    const ws = tmpWorkspace();
    fs.writeFileSync(
      path.join(ws, ".rulesync/global-settings/cursor.json"),
      JSON.stringify({ allow: ["a", "b"] }),
    );
    const home = tmpDir("check-globals-arr-");
    fs.mkdirSync(path.join(home, ".cursor"), { recursive: true });
    fs.writeFileSync(path.join(home, ".cursor/cli-config.json"), JSON.stringify({ allow: ["a", "b"] }));
    expect(
      checkGlobals({ home, workspaceRoot: ws, }).drift?.filter((d: { host: string }) => d.host === "cursor"),
    ).toEqual([]);
    fs.writeFileSync(path.join(home, ".cursor/cli-config.json"), JSON.stringify({ allow: ["a"] }));
    expect(
      checkGlobals({ home, workspaceRoot: ws }).drift?.filter((d: { host: string }) => d.host === "cursor"),
    ).toEqual([{ host: "cursor", dest: ".cursor/cli-config.json", key: "allow" }]);
  });

  it("a key matching skipKeyPattern is never required", () => {
    const ws = tmpWorkspace();
    const home = syncedHome(ws);
    editJson(path.join(ws, ".rulesync/global-settings/claude.json"), (v) => {
      v.apiKey = "payload-secret";
      v.hooks = { PreToolUse: [] };
      v.permissions.token = "x";
    });
    expect(checkGlobals({ home, workspaceRoot: ws })).toEqual({ ok: true, drift: [] });
  });

  it("a missing dest file drifts on every payload key", () => {
    const ws = tmpWorkspace();
    const home = tmpDir("check-globals-empty-");
    const r = checkGlobals({ home, workspaceRoot: ws });
    expect(r.ok).toBe(false);
    expect(r.drift).toContainEqual({
      host: "antigravity",
      dest: ".gemini/antigravity-cli/settings.json",
      key: "toolPermission",
    });
    expect(r.drift).toContainEqual({ host: "grok", dest: ".grok/config.toml", key: "ui.permission_mode" });
    const cli = runCli(ws, home);
    expect(cli.status).toBe(1);
    expect(cli.stderr.trim().split("\n")[0]).toBe(
      `drift: grok .grok/config.toml ui.permission_mode; ${HINT}`,
    );
  });

  it("an unreadable dest is an error with the apply hint", () => {
    const ws = tmpWorkspace();
    const home = syncedHome(ws);
    fs.writeFileSync(path.join(home, ".claude/settings.json"), "{broken");
    const r = checkGlobals({ home, workspaceRoot: ws });
    expect(r.ok).toBe(false);
    expect(r.error).toBe(`unreadable dest: .claude/settings.json; ${HINT}`);
    fs.writeFileSync(path.join(home, ".claude/settings.json"), "[]");
    expect(checkGlobals({ home, workspaceRoot: ws }).error).toBe(
      `unreadable dest: .claude/settings.json; ${HINT}`,
    );
    const cli = runCli(ws, home);
    expect(cli.status).toBe(1);
    expect(cli.stderr).toMatch(/unreadable dest: \.claude\/settings\.json/);
  });

  it("an unreadable dest path (a directory) is an error", () => {
    const ws = tmpWorkspace();
    const home = syncedHome(ws);
    fs.rmSync(path.join(home, ".cursor/cli-config.json"));
    fs.mkdirSync(path.join(home, ".cursor/cli-config.json"));
    expect(checkGlobals({ home, workspaceRoot: ws }).error).toBe(
      `unreadable dest: .cursor/cli-config.json; ${HINT}`,
    );
  });

  it("a deleted payload is an error", () => {
    const ws = tmpWorkspace();
    const home = syncedHome(ws);
    fs.rmSync(path.join(ws, ".rulesync/global-settings/cursor.json"));
    expect(checkGlobals({ home, workspaceRoot: ws }).error).toBe(
      `missing payload: .rulesync/global-settings/cursor.json`,
    );
  });

  it("an unparseable payload is an error", () => {
    const ws = tmpWorkspace();
    const home = syncedHome(ws);
    fs.writeFileSync(path.join(ws, ".rulesync/global-settings/cursor.json"), "{nope");
    expect(checkGlobals({ home, workspaceRoot: ws }).error).toBe(
      `unreadable payload: .rulesync/global-settings/cursor.json`,
    );
  });

  it("a missing manifest is an error", () => {
    const ws = tmpWorkspace();
    fs.rmSync(path.join(ws, ".rulesync/global-settings/manifest.json"));
    expect(checkGlobals({ home: tmpDir("check-globals-nm-"), workspaceRoot: ws }).ok).toBe(false);
  });

  it("requires HOME", () => {
    const saved = process.env.HOME;
    delete process.env.HOME;
    try {
      const r = checkGlobals({ workspaceRoot: tmpWorkspace() });
      expect(r.ok).toBe(false);
      expect(r.error).toBe(`HOME required; ${HINT}`);
    } finally {
      process.env.HOME = saved;
    }
  });

  it("defaults workspaceRoot to cwd", () => {
    const ws = tmpWorkspace();
    const home = syncedHome(ws);
    const prev = process.cwd();
    process.chdir(ws);
    try {
      expect(checkGlobals({ home }).ok).toBe(true);
    } finally {
      process.chdir(prev);
    }
  });

  it("home workspace may set [features] and [agent] on the same file", () => {
    const ws = tmpWorkspace(null);
    const home = syncedHome(ws);
    fs.cpSync(
      path.join(ws, ".rulesync/global-settings"),
      path.join(home, ".rulesync/global-settings"),
      { recursive: true },
    );
    const r = checkGlobals({ home, workspaceRoot: home });
    expect(r).toEqual({ ok: true, drift: [] });
  });

  it("project config with [features] fails", () => {
    const ws = tmpWorkspace(`${PROJECT_OK}\n[features]\ntwo_pass_compaction = true\n`);
    const r = checkGlobals({ home: syncedHome(ws), workspaceRoot: ws });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/\[features\]/);
  });

  it("project config with [agent] still fails", () => {
    const ws = tmpWorkspace(`${PROJECT_OK}\n[agent]\nname = "orchestrator"\n`);
    const r = checkGlobals({ home: syncedHome(ws), workspaceRoot: ws });
    expect(r.ok).toBe(false);
    expect(r.error).toBe("project .grok/config.toml must not set [features] or [agent]");
  });

  it("a missing or unreadable project config fails", () => {
    const missing = tmpWorkspace(null);
    expect(checkGlobals({ home: syncedHome(missing), workspaceRoot: missing }).error).toBe(
      "missing project .grok/config.toml",
    );
    const bad = tmpWorkspace("<<<not-toml>>>");
    expect(checkGlobals({ home: syncedHome(bad), workspaceRoot: bad }).error).toBe(
      "unreadable project .grok/config.toml",
    );
    const dir = tmpWorkspace(null);
    fs.mkdirSync(path.join(dir, ".grok/config.toml"), { recursive: true });
    expect(checkGlobals({ home: syncedHome(dir), workspaceRoot: dir }).error).toBe(
      "unreadable project .grok/config.toml",
    );
  });

  it("does not write real HOME", () => {
    expect(tmpDirs.every((d) => d !== os.homedir() && !d.startsWith(os.homedir() + path.sep))).toBe(
      true,
    );
  });
});
