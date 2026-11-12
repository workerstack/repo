import fs from "node:fs";
import path from "node:path";

import { expect, it } from "vitest";
import { z } from "zod";

import { type JsonObject, readJson } from "../json.ts";
import { tempDir, useTempDirs } from "../sync/__fixtures__/temp-dirs.ts";
import { CLAUDE, readHostDest, repoRoot, stockCopy, stockWorkspace } from "./__fixtures__/sync-global-kit.ts";
import { syncGlobals } from "./sync-global-settings.ts";
import type { SyncResult } from "./sync-global-settings.types.ts";

useTempDirs();

/** Applies the claude host from `stock`, with `consumer` as the workspace and the overlay root. */
function overlaySync(stock: string, consumer: string, home: string): SyncResult {
  return syncGlobals({
    apply: true,
    consumerRoot: consumer,
    home,
    host: "claude",
    sourceRoot: stock,
    workspaceRoot: consumer,
  });
}

function settingsAt(file: string): JsonObject {
  return readJson(z.record(z.string(), z.json()), fs.readFileSync(file, "utf8"));
}

it("a deleted payload errors with its repo-relative path and writes nothing", () => {
  const ws = stockWorkspace([
    "agents/global-settings/claude.json",
    "agents/global-settings/codex.toml",
    "agents/global-settings/grok.toml",
    "agents/global-settings/antigravity.json",
  ]);

  const r = syncGlobals({ apply: true, home: tempDir("yolo-missing-"), workspaceRoot: ws });
  expect(r).toMatchObject({ error: "missing payload: agents/global-settings/cursor.json", ok: false });
  expect(r.report.map((row: { id: string }) => row.id)).toStrictEqual(["grok", "claude", "codex", "antigravity"]);
});

it("an unparseable payload errors", () => {
  const ws = stockWorkspace([
    "agents/global-settings/claude.json",
    "agents/global-settings/codex.toml",
    "agents/global-settings/grok.toml",
    "agents/global-settings/antigravity.json",
    "agents/global-settings/cursor.json",
  ]);

  fs.writeFileSync(path.join(ws, "agents/global-settings/claude.json"), "{nope");
  const r = syncGlobals({ home: tempDir("yolo-badpayload-"), host: "claude", workspaceRoot: ws });
  expect(r).toMatchObject({ error: "unreadable payload: agents/global-settings/claude.json", ok: false });
});

it("unreadable toml dest fails without clobber", () => {
  const home = tempDir("yolo-unread-");
  const dest = path.join(home, ".grok/config.toml");
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const original = "<<<not-toml>>>\nkeep-this\n";
  fs.writeFileSync(dest, original);
  const r = syncGlobals({ apply: true, home, host: "grok", workspaceRoot: repoRoot });
  expect(r.ok).toBe(false);
  expect(fs.readFileSync(dest, "utf8")).toBe(original);
});

it("unreadable json dest fails without clobber", () => {
  const home = tempDir("yolo-unread-json-");
  const dest = path.join(home, ".claude/settings.json");
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, "{broken");
  const r = syncGlobals({ apply: true, home, host: "claude", workspaceRoot: repoRoot });
  expect(r).toMatchObject({ error: "unreadable dest: .claude/settings.json", ok: false });
  expect(fs.readFileSync(dest, "utf8")).toBe("{broken");
});

it("an empty json dest is treated as empty", () => {
  const home = tempDir("yolo-empty-json-");
  const dest = path.join(home, ".claude/settings.json");
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, "  \n");
  expect(syncGlobals({ apply: true, home, host: "claude", workspaceRoot: repoRoot }).ok).toBe(true);
  expect(readHostDest(home, CLAUDE).permissions.defaultMode).toBe("bypassPermissions");
});

it("reads manifest and payloads from the source root, never needing them in the workspace", () => {
  const stock = stockCopy("sync-stock-");
  const out = tempDir("sync-out-");
  const home = tempDir("sync-home-");
  const r = syncGlobals({ apply: true, home, sourceRoot: stock, workspaceRoot: out });
  expect(r.ok).toBe(true);
  expect(r.report.length).toBeGreaterThan(0);
  expect(fs.readdirSync(out)).toStrictEqual([]);
  expect(fs.readdirSync(stock)).toStrictEqual(["agents"]);
  expect(fs.existsSync(path.join(home, ".grok/config.toml"))).toBe(true);
});

it("a payload under .repo/global-settings replaces the stock one whole", () => {
  const stock = stockCopy("sync-overlay-stock-");
  const consumer = tempDir("sync-overlay-consumer-");
  fs.mkdirSync(path.join(consumer, ".repo/global-settings"), { recursive: true });
  fs.writeFileSync(path.join(consumer, ".repo/global-settings/claude.json"), JSON.stringify({ customKey: 1 }));
  const home = tempDir("sync-overlay-home-");
  expect(overlaySync(stock, consumer, home).ok).toBe(true);
  expect(settingsAt(path.join(home, ".claude/settings.json"))).toStrictEqual({ customKey: 1 });
});

it("falls back to the stock payload when the overlay lacks that file", () => {
  const stock = stockCopy("sync-overlay-stock-");
  const home = tempDir("sync-overlay-home-");
  expect(overlaySync(stock, tempDir("sync-overlay-empty-"), home).ok).toBe(true);
  const stockPayload = settingsAt(path.join(stock, "agents/global-settings/claude.json"));
  const written = settingsAt(path.join(home, ".claude/settings.json"));
  expect(Object.keys(written)).toStrictEqual(
    expect.arrayContaining(Object.keys(stockPayload).filter((k) => k !== "hooks")),
  );
  expect(written).not.toHaveProperty("customKey");
});
