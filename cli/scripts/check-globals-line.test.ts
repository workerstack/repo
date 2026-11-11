import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it, vi } from "vitest";

import { checkGlobals, checkHint, checkHosts, checkLine } from "./check-globals.ts";
import type { HostStatus } from "./check-globals.ts";
import { syncGlobals } from "./sync-global-settings.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

const tmpDirs: string[] = [];
afterEach(() => {
  vi.unstubAllEnvs();
  for (const d of tmpDirs.splice(0)) fs.rmSync(d, { force: true, recursive: true });
});

function tmpDir(prefix: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpDirs.push(dir);
  return dir;
}

/** Workspace holding the real manifest and payloads plus a clean project grok config. */
function tmpWorkspace() {
  const ws = tmpDir("globals-ws-");
  fs.cpSync(path.join(repoRoot, "agents/global-settings"), path.join(ws, "agents/global-settings"), {
    recursive: true,
  });
  fs.mkdirSync(path.join(ws, ".grok"), { recursive: true });
  fs.writeFileSync(
    path.join(ws, ".grok/config.toml"),
    '[plugins]\nenabled = []\n\n[permission]\ndeny = [ "MCPTool" ]\n',
  );
  return ws;
}

const drift = (host: string, key: string, kind: "missing" | "differs") => ({ dest: `${host}.json`, host, key, kind });
const status = (id: string, state: HostStatus["state"], entries: HostStatus["drift"] = []): HostStatus => ({
  dest: `${id}.json`,
  drift: entries,
  id,
  state,
});

describe("checkLine", () => {
  it("names each host's state in order, and lists missing then differing keys of a drifted host", () => {
    const statuses = [
      status("grok", "ok"),
      status("claude", "drift", [
        drift("claude", "b", "differs"),
        drift("claude", "a", "missing"),
        drift("claude", "c", "missing"),
      ]),
      status("cursor", "unreadable"),
    ];
    expect(checkLine(statuses)).toBe("grok ok · claude missing a,c differs b · cursor unreadable");
  });

  it("omits the kind a drifted host has no key of", () => {
    expect(checkLine([status("claude", "drift", [drift("claude", "b", "differs")])])).toBe("claude differs b");
    expect(checkLine([status("claude", "drift", [drift("claude", "a", "missing")])])).toBe("claude missing a");
  });
});

describe("checkHint", () => {
  it("shows the apply hint only when some host drifted", () => {
    expect(checkHint([status("grok", "ok"), status("claude", "drift", [drift("claude", "a", "missing")])])).toBe(
      "run `bun repo yolo`",
    );
    expect(checkHint([status("grok", "ok"), status("cursor", "unreadable")])).toBeNull();
  });
});

describe("checkHosts", () => {
  it("checks one named host alone and rejects an unknown one", () => {
    const ws = tmpWorkspace();
    const home = tmpDir("globals-home-");
    expect(syncGlobals({ apply: true, home, workspaceRoot: ws }).ok).toBe(true);
    const only = checkHosts({ home, host: "claude", workspaceRoot: ws });
    expect(only.map((s) => s.id)).toStrictEqual(["claude"]);
    expect(only[0]?.state).toBe("ok");
    expect(() => checkHosts({ home, host: "nowhere", workspaceRoot: ws })).toThrow("unknown host: nowhere");
  });
});

describe("checkGlobals with every argument defaulted", () => {
  it("checks the working directory against the HOME of the environment", () => {
    const ws = tmpWorkspace();
    const home = tmpDir("globals-home-");
    expect(syncGlobals({ apply: true, home, workspaceRoot: ws }).ok).toBe(true);
    vi.stubEnv("HOME", home);
    const prev = process.cwd();
    process.chdir(ws);
    try {
      expect(checkGlobals()).toStrictEqual({ drift: [], ok: true });
    } finally {
      process.chdir(prev);
    }
  });
});
