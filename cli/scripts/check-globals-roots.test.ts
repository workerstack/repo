import fs from "node:fs";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import { useTempDirs } from "../sync/__fixtures__/temp-dirs.ts";
import {
  PROJECT_OK,
  projectOnly,
  stockCopy,
  HINT,
  tmpDir,
  tmpWorkspace,
  syncedHome,
} from "./__fixtures__/check-globals-kit.ts";
import { checkGlobals } from "./check-globals.ts";
import { syncGlobals } from "./sync-global-settings.ts";

useTempDirs();

describe("checkGlobals", () => {
  it("requires HOME", () => {
    vi.stubEnv("HOME", undefined);
    const r = checkGlobals({ workspaceRoot: tmpWorkspace() });
    expect(r.ok).toBe(false);
    expect(r.error).toBe(`HOME required; ${HINT}`);
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
    fs.cpSync(path.join(ws, "agents/global-settings"), path.join(home, "agents/global-settings"), { recursive: true });
    const r = checkGlobals({ home, workspaceRoot: home });
    expect(r).toStrictEqual({ drift: [], ok: true });
  });
});

describe("checkGlobals", () => {
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
});

describe("sourceRoot", () => {
  it("reads manifest and payloads from the source root and the project config from the workspace", () => {
    const stock = stockCopy("yolo-stock-");
    const ws = projectOnly("yolo-out-");
    const home = tmpDir("yolo-home-");
    expect(syncGlobals({ apply: true, home, sourceRoot: stock, workspaceRoot: ws }).ok).toBe(true);
    expect(checkGlobals({ home, sourceRoot: stock, workspaceRoot: ws })).toMatchObject({ ok: true });
    expect(checkGlobals({ home, workspaceRoot: ws })).toMatchObject({ ok: false });
    expect(fs.existsSync(path.join(ws, "agents"))).toBe(false);
    expect(fs.existsSync(path.join(stock, ".grok"))).toBe(false);
  });
});

describe("consumerRoot overlay", () => {
  it("checks the overlay payload instead of the stock one, and the stock one when no overlay exists", () => {
    const stock = stockCopy("yolo-ov-stock-");
    const ws = projectOnly("yolo-ov-ws-");
    fs.mkdirSync(path.join(ws, ".repo/global-settings"), { recursive: true });
    fs.writeFileSync(path.join(ws, ".repo/global-settings/claude.json"), JSON.stringify({ customKey: 1 }));
    const home = tmpDir("yolo-ov-home-");
    expect(syncGlobals({ apply: true, consumerRoot: ws, home, sourceRoot: stock, workspaceRoot: ws }).ok).toBe(true);
    expect(checkGlobals({ home, sourceRoot: stock, workspaceRoot: ws })).toMatchObject({ ok: true });
    const settings = path.join(home, ".claude/settings.json");

    const written = JSON.parse(fs.readFileSync(settings, "utf8")) /* sync wrote a JSON object */ as Record<
      string,
      unknown
    >;

    delete written.customKey;
    fs.writeFileSync(settings, JSON.stringify(written));
    expect(checkGlobals({ home, sourceRoot: stock, workspaceRoot: ws })).toMatchObject({
      drift: [{ host: "claude", key: "customKey" }],
      ok: false,
    });
    fs.rmSync(path.join(ws, ".repo"), { recursive: true });
    expect(
      checkGlobals({ home, sourceRoot: stock, workspaceRoot: ws }).drift?.some((d) => d.key === "customKey"),
    ).toBeFalsy();
  });
});
