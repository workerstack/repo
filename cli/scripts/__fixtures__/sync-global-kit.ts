import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parse as parseToml, stringify as stringifyToml } from "smol-toml";
import { afterEach, vi } from "vitest";

import { bunPath } from "../../../dev/test-paths";
import { childEnv } from "../../env.ts";
import { tempDir } from "../../sync/__fixtures__/temp-dirs.ts";
import type { SettingsValue } from "../settings-table.ts";

/** Planted dirs under the OS temp dir, removed after each case; nothing here touches the real home. */
export function plantDirs(): (prefix: string) => string {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
  });
  return (prefix) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    dirs.push(dir);
    return dir;
  };
}

/** Write `body` at `rel` under `root`, creating parent dirs. */
export function plant(root: string, rel: string, body: string): string {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, body);
  return abs;
}

/** A workspace holding `manifest` as the stock manifest; `payloads` maps repo-relative paths to file text. */
export function plantWorkspace(
  make: (prefix: string) => string,
  manifest: unknown,
  payloads: Record<string, string> = {},
): string {
  const ws = make("yolo-kit-ws-");
  plant(ws, "agents/global-settings/manifest.json", typeof manifest === "string" ? manifest : JSON.stringify(manifest));
  for (const [rel, body] of Object.entries(payloads)) plant(ws, rel, body);
  return ws;
}

/** Collect what the code under test writes to stdout and stderr; the caller restores mocks after each case. */
export function captureStreams(): { out: () => string; err: () => string; reset: () => void } {
  const out: string[] = [];
  const err: string[] = [];
  vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    out.push(String(chunk));
    return true;
  });
  vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
    err.push(String(chunk));
    return true;
  });
  return {
    out: () => out.join(""),
    err: () => err.join(""),
    reset: () => {
      out.length = 0;
      err.length = 0;
    },
  };
}

/** The package root, holding the stock manifest and payloads. */
export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

/** The stock hosts in manifest order. */
export const HOSTS = [
  { dest: ".grok/config.toml", format: "toml", id: "grok" },
  { dest: ".claude/settings.json", format: "json", id: "claude" },
  { dest: ".codex/config.toml", format: "toml", id: "codex" },
  { dest: ".gemini/antigravity-cli/settings.json", format: "json", id: "antigravity" },
  { dest: ".cursor/cli-config.json", format: "json", id: "cursor" },
  { dest: ".config/opencode/opencode.json", format: "json", id: "opencode" },
] as const;

export const CLAUDE = HOSTS[1];

/** The keys the tests read back from a written dest; each host's file holds only its own. */
export type DestKeys = {
  keepMe: SettingsValue;
  approvalMode: string;
  permissions: { defaultMode: string };
  skipDangerousModePermissionPrompt: boolean;
  approval_policy: string;
  sandbox_mode: string;
  ui: { permission_mode: string };
  agent: { name: string };
  features: { two_pass_compaction: boolean };
  toolPermission: string;
};

/** The dest file a host's sync wrote under `home`, parsed. */
export function readHostDest(home: string, h: { dest: string; format: string }): DestKeys {
  const raw = fs.readFileSync(path.join(home, h.dest), "utf8");
  return (h.format === "json" ? JSON.parse(raw) : parseToml(raw)) as DestKeys;
}

/** Plants a host's dest file under `home` holding `value`. */
export function writeHostDest(home: string, h: { dest: string; format: string }, value: object): void {
  const abs = path.join(home, h.dest);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, h.format === "json" ? JSON.stringify(value) : stringifyToml(value));
}

/** Workspace with the real manifest and only the payload files named in `payloads`. */
export function stockWorkspace(payloads: string[]): string {
  const ws = tempDir("yolo-ws-");
  fs.mkdirSync(path.join(ws, "agents/global-settings"), { recursive: true });
  fs.copyFileSync(
    path.join(repoRoot, "agents/global-settings/manifest.json"),
    path.join(ws, "agents/global-settings/manifest.json"),
  );
  for (const rel of payloads) {
    fs.mkdirSync(path.dirname(path.join(ws, rel)), { recursive: true });
    fs.copyFileSync(path.join(repoRoot, rel), path.join(ws, rel));
  }
  return ws;
}

/** A temp copy of the stock `agents/global-settings`, as a source root. */
export function stockCopy(prefix: string): string {
  const stock = tempDir(prefix);
  fs.cpSync(path.join(repoRoot, "agents/global-settings"), path.join(stock, "agents/global-settings"), {
    recursive: true,
  });
  return stock;
}

/** `repo yolo` with `args`, run from `cwd` with `home` as HOME. */
export function runYolo(args: string[], home: string, cwd: string = repoRoot): SpawnSyncReturns<string> {
  return spawnSync(bunPath(), [path.join(repoRoot, "bin", "repo.ts"), "yolo", ...args], {
    cwd,
    encoding: "utf8",
    env: childEnv({ HOME: home }),
    timeout: 20_000,
  });
}
