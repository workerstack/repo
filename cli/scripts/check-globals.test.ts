import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { useTempDirs } from "../sync/fixtures/temp-dirs.ts";
import { checkGlobals, driftLine } from "./check-globals.ts";
import {
  HINT,
  tmpDir,
  tmpWorkspace,
  syncedHome,
  runCli,
  editJson,
  madeDirs,
  firstDrift,
} from "./fixtures/check-globals-kit.ts";

useTempDirs();

describe("checkGlobals", () => {
  it("passes when every payload key is present in its dest", () => {
    const ws = tmpWorkspace();
    const home = syncedHome(ws);
    expect(checkGlobals({ home, workspaceRoot: ws })).toStrictEqual({ drift: [], ok: true });
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
    expect(r.drift).toStrictEqual([
      { dest: ".cursor/cli-config.json", host: "cursor", key: "approvalMode", kind: "missing" },
    ]);
    const cli = runCli(ws, home);
    expect(cli.status).toBe(1);
    expect(cli.stdout.trim().split("\n")).toStrictEqual([
      "grok ok · claude ok · codex ok · antigravity ok · cursor missing approvalMode",
      HINT,
    ]);
  });
});

describe("checkGlobals", () => {
  it("a wrong nested value drifts with a dotted key", () => {
    const ws = tmpWorkspace();
    const home = syncedHome(ws);
    editJson(path.join(home, ".claude/settings.json"), (v) => {
      v.permissions.defaultMode = "default";
      v.extra = true;
    });
    const r = checkGlobals({ home, workspaceRoot: ws });
    expect(r.drift).toStrictEqual([
      { dest: ".claude/settings.json", host: "claude", key: "permissions.defaultMode", kind: "differs" },
    ]);
  });

  it("a toml dest with a changed table value drifts", () => {
    const ws = tmpWorkspace();
    const home = syncedHome(ws);
    fs.writeFileSync(path.join(home, ".codex/config.toml"), 'approval_policy = "on-request"\n');
    const r = checkGlobals({ home, workspaceRoot: ws });
    expect(r.drift?.map((d: { key: string }) => d.key)).toStrictEqual(["approval_policy", "sandbox_mode"]);
    expect(driftLine(firstDrift(r))).toBe(`drift: codex .codex/config.toml approval_policy; ${HINT}`);
  });
});

describe("checkGlobals", () => {
  it("array payload values compare by deep equality", () => {
    const ws = tmpWorkspace();
    fs.writeFileSync(path.join(ws, "agents/global-settings/cursor.json"), JSON.stringify({ allow: ["a", "b"] }));
    const home = tmpDir("yolo-arr-");
    fs.mkdirSync(path.join(home, ".cursor"), { recursive: true });
    fs.writeFileSync(path.join(home, ".cursor/cli-config.json"), JSON.stringify({ allow: ["a", "b"] }));
    expect(
      checkGlobals({ home, workspaceRoot: ws }).drift?.filter((d: { host: string }) => d.host === "cursor"),
    ).toStrictEqual([]);
    fs.writeFileSync(path.join(home, ".cursor/cli-config.json"), JSON.stringify({ allow: ["a"] }));
    expect(
      checkGlobals({ home, workspaceRoot: ws }).drift?.filter((d: { host: string }) => d.host === "cursor"),
    ).toStrictEqual([{ dest: ".cursor/cli-config.json", host: "cursor", key: "allow", kind: "differs" }]);
  });

  it("a key matching skipKeyPattern is never required", () => {
    const ws = tmpWorkspace();
    const home = syncedHome(ws);
    editJson(path.join(ws, "agents/global-settings/claude.json"), (v) => {
      v.apiKey = "payload-secret";
      v.hooks = { PreToolUse: [] };
      v.permissions.token = "x";
    });
    expect(checkGlobals({ home, workspaceRoot: ws })).toStrictEqual({ drift: [], ok: true });
  });
});

describe("checkGlobals", () => {
  it("a missing dest file drifts on every payload key", () => {
    const ws = tmpWorkspace();
    const home = tmpDir("yolo-empty-");
    const r = checkGlobals({ home, workspaceRoot: ws });
    expect(r.ok).toBe(false);
    expect(r.drift).toContainEqual({
      dest: ".gemini/antigravity-cli/settings.json",
      host: "antigravity",
      key: "toolPermission",
      kind: "missing",
    });
    expect(r.drift).toContainEqual({
      dest: ".grok/config.toml",
      host: "grok",
      key: "ui.permission_mode",
      kind: "missing",
    });
    const cli = runCli(ws, home);
    expect(cli.status).toBe(1);
    expect(cli.stdout).toMatch(/^grok missing .*ui\.permission_mode.* · claude missing /);
    expect(cli.stdout.trim().split("\n")[1]).toBe(HINT);
  });
});

describe("checkGlobals", () => {
  it("an unreadable dest is an error with the apply hint", () => {
    const ws = tmpWorkspace();
    const home = syncedHome(ws);
    fs.writeFileSync(path.join(home, ".claude/settings.json"), "{broken");
    const r = checkGlobals({ home, workspaceRoot: ws });
    expect(r.ok).toBe(false);
    expect(r.error).toBe(`unreadable dest: .claude/settings.json; ${HINT}`);
    fs.writeFileSync(path.join(home, ".claude/settings.json"), "[]");
    expect(checkGlobals({ home, workspaceRoot: ws }).error).toBe(`unreadable dest: .claude/settings.json; ${HINT}`);
    const cli = runCli(ws, home);
    expect(cli.status).toBe(1);
    expect(cli.stdout.split("\n")[0]).toContain("claude unreadable");
  });

  it("an unreadable dest path (a directory) is an error", () => {
    const ws = tmpWorkspace();
    const home = syncedHome(ws);
    fs.rmSync(path.join(home, ".cursor/cli-config.json"));
    fs.mkdirSync(path.join(home, ".cursor/cli-config.json"));
    expect(checkGlobals({ home, workspaceRoot: ws }).error).toBe(`unreadable dest: .cursor/cli-config.json; ${HINT}`);
  });

  it("a deleted payload is an error", () => {
    const ws = tmpWorkspace();
    const home = syncedHome(ws);
    fs.rmSync(path.join(ws, "agents/global-settings/cursor.json"));
    expect(checkGlobals({ home, workspaceRoot: ws }).error).toBe(`missing payload: agents/global-settings/cursor.json`);
  });
});

describe("checkGlobals", () => {
  it("an unparseable payload is an error", () => {
    const ws = tmpWorkspace();
    const home = syncedHome(ws);
    fs.writeFileSync(path.join(ws, "agents/global-settings/cursor.json"), "{nope");
    expect(checkGlobals({ home, workspaceRoot: ws }).error).toBe(
      `unreadable payload: agents/global-settings/cursor.json`,
    );
  });

  it("a missing manifest is an error", () => {
    const ws = tmpWorkspace();
    fs.rmSync(path.join(ws, "agents/global-settings/manifest.json"));
    expect(checkGlobals({ home: tmpDir("yolo-nm-"), workspaceRoot: ws }).ok).toBe(false);
  });

  it("does not write real HOME", () => {
    const tmpRoot = fs.realpathSync(os.tmpdir());
    const home = fs.realpathSync(os.homedir());
    for (const dir of madeDirs()) {
      const real = path.join(fs.realpathSync(path.dirname(dir)), path.basename(dir));
      expect(real.startsWith(tmpRoot + path.sep)).toBe(true);
      expect(real).not.toBe(home);
    }
  });
});
