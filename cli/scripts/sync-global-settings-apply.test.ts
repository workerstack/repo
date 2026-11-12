import fs from "node:fs";
import path from "node:path";

import { parse as parseToml } from "smol-toml";
import { expect, it } from "vitest";

import { tempDir, useTempDirs } from "../sync/__fixtures__/temp-dirs.ts";
import type { DestShape } from "./__fixtures__/sync-global-kit.ts";
import { CLAUDE, HOSTS, readHostDest, repoRoot, writeHostDest } from "./__fixtures__/sync-global-kit.ts";
import { isRecord } from "./hook-input.ts";
import { syncGlobals } from "./sync-global-settings.ts";

useTempDirs();

/** The stock manifest's host list. */
type StockManifest = { hosts: { id: string; payload: string }[] };

it("reports `{action} {id} {dest}` per host in manifest order", () => {
  const home = tempDir("yolo-dry-");
  const r = syncGlobals({ apply: false, home, workspaceRoot: repoRoot });
  expect(r.ok).toBe(true);
  expect(r.report.map((row: { line: string }) => row.line)).toStrictEqual(
    HOSTS.map((h) => `dry-run ${h.id} ${h.dest}`),
  );
  const applied = syncGlobals({ apply: true, home: tempDir("yolo-line-"), host: "cursor", workspaceRoot: repoRoot });
  expect(applied.report.map((row: { line: string }) => row.line)).toStrictEqual([
    "apply cursor .cursor/cli-config.json",
  ]);
});

it("dry-run writes nothing under home", () => {
  const home = tempDir("yolo-dry-none-");
  const r = syncGlobals({ apply: false, home, workspaceRoot: repoRoot });
  expect(r.ok).toBe(true);
  expect(fs.readdirSync(home)).toStrictEqual([]);
});

it.each(HOSTS)("$id: apply creates a missing dest from the payload", (h) => {
  const home = tempDir(`yolo-create-${h.id}-`);
  const r = syncGlobals({ apply: true, home, host: h.id, workspaceRoot: repoRoot });
  expect(r.ok).toBe(true);
  const manifestText = fs.readFileSync(path.join(repoRoot, "agents/global-settings/manifest.json"), "utf8");
  const manifest = JSON.parse(manifestText) /* the stock manifest's shape */ as StockManifest;
  const payloadRel = manifest.hosts.find((x) => x.id === h.id)?.payload ?? "";
  const raw = fs.readFileSync(path.join(repoRoot, payloadRel), "utf8");
  const payload: unknown = h.format === "json" ? JSON.parse(raw) : parseToml(raw);
  expect(readHostDest(home, h)).toStrictEqual(payload);
});

it("writes the Usage keys for every host", () => {
  const home = tempDir("yolo-usage-");
  expect(syncGlobals({ apply: true, home, workspaceRoot: repoRoot }).ok).toBe(true);
  const dests = HOSTS.map((h) => readHostDest(home, h));

  const [grok, claude, codex, agy, cursor] = dests /* one per HOSTS entry */ as [
    DestShape,
    DestShape,
    DestShape,
    DestShape,
    DestShape,
  ];

  expect(claude.permissions.defaultMode).toBe("bypassPermissions");
  expect(claude.skipDangerousModePermissionPrompt).toBe(true);
  expect(codex.approval_policy).toBe("never");
  expect(codex.sandbox_mode).toBe("danger-full-access");
  expect(grok.ui.permission_mode).toBe("always-approve");
  expect(grok.agent.name).toBe("orchestrator");
  expect(grok.features.two_pass_compaction).toBe(true);
  expect(agy.toolPermission).toBe("always-proceed");
  expect(cursor.approvalMode).toBe("unrestricted");
});

it.each(HOSTS)("$id: unrelated dest keys survive apply", (h) => {
  const home = tempDir(`yolo-keep-${h.id}-`);
  writeHostDest(home, h, { approvalMode: "ask", keepMe: { nested: true } });
  const r = syncGlobals({ apply: true, home, host: h.id, workspaceRoot: repoRoot });
  expect(r.ok).toBe(true);
  // A TOML table parses with no prototype; spread it into a plain object so only its keys and values are compared.
  const { keepMe } = readHostDest(home, h);
  expect(isRecord(keepMe) ? { ...keepMe } : keepMe).toStrictEqual({ nested: true });
});

it("cursor: the payload wins over a dest key", () => {
  const home = tempDir("yolo-keep-cursor-wins-");
  const cursor = HOSTS[4];
  writeHostDest(home, cursor, { approvalMode: "ask", keepMe: { nested: true } });
  expect(syncGlobals({ apply: true, home, host: "cursor", workspaceRoot: repoRoot }).ok).toBe(true);
  expect(readHostDest(home, cursor).approvalMode).toBe("unrestricted");
});

it("keeps sibling keys inside a merged table", () => {
  const home = tempDir("yolo-sibling-");
  writeHostDest(home, CLAUDE, { permissions: { allow: ["Bash(ls)"], defaultMode: "default" } });
  expect(syncGlobals({ apply: true, home, host: "claude", workspaceRoot: repoRoot }).ok).toBe(true);
  expect(readHostDest(home, CLAUDE).permissions).toStrictEqual({
    allow: ["Bash(ls)"],
    defaultMode: "bypassPermissions",
  });
});

it("a repeated apply is idempotent", () => {
  const home = tempDir("yolo-idem-");
  syncGlobals({ apply: true, home, workspaceRoot: repoRoot });
  const first = HOSTS.map((h) => fs.readFileSync(path.join(home, h.dest), "utf8"));
  syncGlobals({ apply: true, home, workspaceRoot: repoRoot });
  expect(HOSTS.map((h) => fs.readFileSync(path.join(home, h.dest), "utf8"))).toStrictEqual(first);
});

it("rejects an unknown host", () => {
  const r = syncGlobals({ home: tempDir("yolo-bad-"), host: "gemini", workspaceRoot: repoRoot });
  expect(r).toMatchObject({ error: "unknown host: gemini", ok: false });
});
