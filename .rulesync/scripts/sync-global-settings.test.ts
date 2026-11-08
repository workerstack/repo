import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { parse as parseToml, stringify as stringifyToml } from "smol-toml";
import {
  deepMerge,
  parseArgv,
  resolveDest,
  shouldSkip,
  syncGlobals,
} from "./sync-global-settings.ts";
import { BUN } from "../../dev/test-paths";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");
const script = path.join(here, "sync-global-settings.ts");
const skipRe = new RegExp(
  "^(secrets?|api[_-]?key|access[_-]?token|tokens?|passwords?|authorization|mcp(servers)?|hooks)$",
  "i",
);

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

describe("parseArgv", () => {
  it("defaults to dry-run host all", () => {
    expect(parseArgv([])).toEqual({ ok: true, apply: false, host: "all" });
    expect(parseArgv(["--apply"])).toMatchObject({ ok: true, apply: true, host: "all" });
    expect(parseArgv(["--host", "grok"])).toMatchObject({
      ok: true,
      apply: false,
      host: "grok",
    });
    expect(parseArgv(["--host=claude", "--apply"])).toMatchObject({
      ok: true,
      apply: true,
      host: "claude",
    });
  });

  it("rejects a bad host or flag", () => {
    expect(parseArgv(["--host=nope"])).toMatchObject({ ok: true, host: "nope" });
    expect(parseArgv(["--host="])).toEqual({ ok: false, error: "unknown host: " });
    expect(parseArgv(["--wat"]).ok).toBe(false);
    expect(parseArgv(["--host"]).ok).toBe(false);
  });
});

describe("resolveDest", () => {
  it("rejects dest outside home", () => {
    const home = path.join(os.tmpdir(), "sync-globals-home");
    expect(() => resolveDest(home, "../.ssh/config")).toThrow();
    expect(() => resolveDest(home, "/etc/passwd")).toThrow();
    expect(resolveDest(home, ".grok/config.toml")).toBe(
      path.resolve(home, ".grok/config.toml"),
    );
  });
});

describe("deepMerge", () => {
  it("keeps dest-only keys and skips mcp/hooks/apiKey", () => {
    expect(shouldSkip("hooks", skipRe)).toBe(true);
    expect(shouldSkip("mcp", skipRe)).toBe(true);
    expect(shouldSkip("apiKey", skipRe)).toBe(true);
    expect(shouldSkip("features", skipRe)).toBe(false);
    const dest = {
      keepMe: 1,
      apiKey: "dest-secret",
      mcp: { servers: { old: true } },
      features: {
        two_pass_compaction: false,
        hooks: "dest-hooks",
      },
    };
    const source = {
      apiKey: "src-secret",
      mcp: { servers: { new: true } },
      hooks: { on: true },
      features: {
        two_pass_compaction: true,
        hooks: "src-hooks",
      },
      agent: { name: "orchestrator" },
    };
    const merged = deepMerge(dest, source, skipRe) as Record<string, unknown> & {
      features: { two_pass_compaction: boolean; hooks: string };
    };
    expect(merged.keepMe).toBe(1);
    expect(merged.apiKey).toBe("dest-secret");
    expect(merged.mcp).toEqual({ servers: { old: true } });
    expect(merged.hooks).toBeUndefined();
    expect(merged.features.two_pass_compaction).toBe(true);
    expect(merged.features.hooks).toBe("dest-hooks");
    expect(merged.agent).toEqual({ name: "orchestrator" });
  });
});

const HOSTS = [
  { id: "grok", dest: ".grok/config.toml", format: "toml" },
  { id: "claude", dest: ".claude/settings.json", format: "json" },
  { id: "codex", dest: ".codex/config.toml", format: "toml" },
  { id: "antigravity", dest: ".gemini/antigravity-cli/settings.json", format: "json" },
  { id: "cursor", dest: ".cursor/cli-config.json", format: "json" },
] as const;

const CLAUDE = HOSTS[1];

/** The keys the tests read back from a written dest; each host's file holds only its own. */
interface DestShape {
  keepMe: unknown;
  approvalMode: string;
  permissions: { defaultMode: string };
  skipDangerousModePermissionPrompt: boolean;
  approval_policy: string;
  sandbox_mode: string;
  ui: { permission_mode: string };
  agent: { name: string };
  features: { two_pass_compaction: boolean };
  toolPermission: string;
}

function readDest(home: string, h: { dest: string; format: string }): DestShape {
  const raw = fs.readFileSync(path.join(home, h.dest), "utf8");
  return (h.format === "json" ? JSON.parse(raw) : parseToml(raw)) as DestShape;
}

function writeDest(home: string, h: { dest: string; format: string }, value: object) {
  const abs = path.join(home, h.dest);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(
    abs,
    h.format === "json" ? JSON.stringify(value) : stringifyToml(value as never),
  );
}

/** Workspace with the real manifest and only the payload files named in `payloads`. */
function tmpWorkspace(payloads: string[]) {
  const ws = tmpDir("sync-globals-ws-");
  fs.mkdirSync(path.join(ws, ".rulesync/global-settings"), { recursive: true });
  fs.copyFileSync(
    path.join(repoRoot, ".rulesync/global-settings/manifest.json"),
    path.join(ws, ".rulesync/global-settings/manifest.json"),
  );
  for (const rel of payloads) {
    fs.mkdirSync(path.dirname(path.join(ws, rel)), { recursive: true });
    fs.copyFileSync(path.join(repoRoot, rel), path.join(ws, rel));
  }
  return ws;
}

describe("syncGlobals", () => {
  it("reports `{action} {id} {dest}` per host in manifest order", () => {
    const home = tmpDir("sync-globals-dry-");
    const r = syncGlobals({ workspaceRoot: repoRoot, home, apply: false });
    expect(r.ok).toBe(true);
    expect(r.report.map((row: { line: string }) => row.line)).toEqual(
      HOSTS.map((h) => `dry-run ${h.id} ${h.dest}`),
    );
    const applied = syncGlobals({
      workspaceRoot: repoRoot,
      home: tmpDir("sync-globals-line-"),
      apply: true,
      host: "cursor",
    });
    expect(applied.report.map((row: { line: string }) => row.line)).toEqual([
      "apply cursor .cursor/cli-config.json",
    ]);
  });

  it("dry-run writes nothing under home", () => {
    const home = tmpDir("sync-globals-dry-none-");
    const r = syncGlobals({ workspaceRoot: repoRoot, home, apply: false });
    expect(r.ok).toBe(true);
    expect(fs.readdirSync(home)).toEqual([]);
  });

  it.each(HOSTS)("$id: apply creates a missing dest from the payload", (h) => {
    const home = tmpDir(`sync-globals-create-${h.id}-`);
    const r = syncGlobals({ workspaceRoot: repoRoot, home, apply: true, host: h.id });
    expect(r.ok).toBe(true);
    const manifest = JSON.parse(
      fs.readFileSync(path.join(repoRoot, ".rulesync/global-settings/manifest.json"), "utf8"),
    ) as { hosts: { id: string; payload: string }[] };
    const payloadRel = manifest.hosts.find((x) => x.id === h.id)!.payload; // every HOSTS id is in the manifest
    const raw = fs.readFileSync(path.join(repoRoot, payloadRel), "utf8");
    const payload = h.format === "json" ? JSON.parse(raw) : parseToml(raw);
    expect(readDest(home, h)).toEqual(payload);
  });

  it("writes the Usage keys for every host", () => {
    const home = tmpDir("sync-globals-usage-");
    expect(syncGlobals({ workspaceRoot: repoRoot, home, apply: true }).ok).toBe(true);
    const [grok, claude, codex, agy, cursor] = HOSTS.map((h) => readDest(home, h)) as [
      DestShape,
      DestShape,
      DestShape,
      DestShape,
      DestShape,
    ]; // one per HOSTS entry
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

  it.each(HOSTS)("$id: unrelated dest keys survive apply and the payload wins", (h) => {
    const home = tmpDir(`sync-globals-keep-${h.id}-`);
    writeDest(home, h, { keepMe: { nested: true }, approvalMode: "ask" });
    const r = syncGlobals({ workspaceRoot: repoRoot, home, apply: true, host: h.id });
    expect(r.ok).toBe(true);
    const out = readDest(home, h);
    expect(out.keepMe).toEqual({ nested: true });
    if (h.id === "cursor") expect(out.approvalMode).toBe("unrestricted");
  });

  it("keeps sibling keys inside a merged table", () => {
    const home = tmpDir("sync-globals-sibling-");
    writeDest(home, CLAUDE, { permissions: { allow: ["Bash(ls)"], defaultMode: "default" } });
    expect(syncGlobals({ workspaceRoot: repoRoot, home, apply: true, host: "claude" }).ok).toBe(
      true,
    );
    expect(readDest(home, CLAUDE).permissions).toEqual({
      allow: ["Bash(ls)"],
      defaultMode: "bypassPermissions",
    });
  });

  it("a repeated apply is idempotent", () => {
    const home = tmpDir("sync-globals-idem-");
    syncGlobals({ workspaceRoot: repoRoot, home, apply: true });
    const first = HOSTS.map((h) => fs.readFileSync(path.join(home, h.dest), "utf8"));
    syncGlobals({ workspaceRoot: repoRoot, home, apply: true });
    expect(HOSTS.map((h) => fs.readFileSync(path.join(home, h.dest), "utf8"))).toEqual(first);
  });

  it("rejects an unknown host", () => {
    const r = syncGlobals({ workspaceRoot: repoRoot, home: tmpDir("sync-globals-bad-"), host: "gemini" });
    expect(r).toMatchObject({ ok: false, error: "unknown host: gemini" });
  });

  it("a deleted payload errors with its repo-relative path and writes nothing", () => {
    const ws = tmpWorkspace([
      ".rulesync/global-settings/claude.json",
      ".rulesync/global-settings/codex.toml",
      ".rulesync/global-settings/grok.toml",
      ".rulesync/global-settings/antigravity.json",
    ]);
    const home = tmpDir("sync-globals-missing-");
    const r = syncGlobals({ workspaceRoot: ws, home, apply: true });
    expect(r).toMatchObject({
      ok: false,
      error: "missing payload: .rulesync/global-settings/cursor.json",
    });
    expect(r.report.map((row: { id: string }) => row.id)).toEqual([
      "grok",
      "claude",
      "codex",
      "antigravity",
    ]);
  });

  it("an unparseable payload errors", () => {
    const ws = tmpWorkspace([
      ".rulesync/global-settings/claude.json",
      ".rulesync/global-settings/codex.toml",
      ".rulesync/global-settings/grok.toml",
      ".rulesync/global-settings/antigravity.json",
      ".rulesync/global-settings/cursor.json",
    ]);
    fs.writeFileSync(path.join(ws, ".rulesync/global-settings/claude.json"), "{nope");
    const r = syncGlobals({ workspaceRoot: ws, home: tmpDir("sync-globals-badpayload-"), host: "claude" });
    expect(r).toMatchObject({
      ok: false,
      error: "unreadable payload: .rulesync/global-settings/claude.json",
    });
  });

  it("unreadable toml dest fails without clobber", () => {
    const home = tmpDir("sync-globals-unread-");
    const dest = path.join(home, ".grok/config.toml");
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const original = "<<<not-toml>>>\nkeep-this\n";
    fs.writeFileSync(dest, original);
    const r = syncGlobals({ workspaceRoot: repoRoot, home, apply: true, host: "grok" });
    expect(r.ok).toBe(false);
    expect(fs.readFileSync(dest, "utf8")).toBe(original);
  });

  it("unreadable json dest fails without clobber", () => {
    const home = tmpDir("sync-globals-unread-json-");
    const dest = path.join(home, ".claude/settings.json");
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, "{broken");
    const r = syncGlobals({ workspaceRoot: repoRoot, home, apply: true, host: "claude" });
    expect(r).toMatchObject({ ok: false, error: "unreadable dest: .claude/settings.json" });
    expect(fs.readFileSync(dest, "utf8")).toBe("{broken");
  });

  it("an empty json dest is treated as empty", () => {
    const home = tmpDir("sync-globals-empty-json-");
    const dest = path.join(home, ".claude/settings.json");
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, "  \n");
    expect(syncGlobals({ workspaceRoot: repoRoot, home, apply: true, host: "claude" }).ok).toBe(
      true,
    );
    expect(readDest(home, CLAUDE).permissions.defaultMode).toBe("bypassPermissions");
  });
});

describe("CLI", () => {
  it("smoke: dry-run with fake HOME", () => {
    const home = tmpDir("sync-globals-cli-");
    const r = spawnSync(BUN, [script], {
      encoding: "utf8",
      cwd: repoRoot,
      timeout: 20_000,
      env: { ...process.env, HOME: home },
    });
    expect(r.status).toBe(0);
    expect(r.stdout.trim().split("\n")).toEqual(HOSTS.map((h) => `dry-run ${h.id} ${h.dest}`));
    expect(fs.readdirSync(home)).toEqual([]);
  });

  it("--host gemini exits 1 with unknown host", () => {
    const r = spawnSync(BUN, [script, "--host", "gemini"], {
      encoding: "utf8",
      cwd: repoRoot,
      timeout: 20_000,
      env: { ...process.env, HOME: tmpDir("sync-globals-cli-bad-") },
    });
    expect(r.status).toBe(1);
    expect(r.stderr.trim()).toBe("unknown host: gemini");
  });
});

describe("sourceRoot", () => {
  it("reads manifest and payloads from the source root, never needing them in the workspace", () => {
    const stock = tmpDir("sync-stock-");
    fs.cpSync(path.join(repoRoot, ".rulesync/global-settings"), path.join(stock, ".rulesync/global-settings"), { recursive: true });
    const out = tmpDir("sync-out-");
    const home = tmpDir("sync-home-");
    const r = syncGlobals({ workspaceRoot: out, sourceRoot: stock, home, apply: true });
    expect(r.ok).toBe(true);
    expect(r.report.length).toBeGreaterThan(0);
    expect(fs.readdirSync(out)).toEqual([]);
    expect(fs.readdirSync(stock)).toEqual([".rulesync"]);
    expect(fs.existsSync(path.join(home, ".grok/config.toml"))).toBe(true);
  });
});

describe("consumerRoot overlay", () => {
  function stockCopy() {
    const stock = tmpDir("sync-overlay-stock-");
    fs.cpSync(path.join(repoRoot, ".rulesync/global-settings"), path.join(stock, ".rulesync/global-settings"), { recursive: true });
    return stock;
  }

  it("a payload under .repo/global-settings replaces the stock one whole", () => {
    const stock = stockCopy();
    const consumer = tmpDir("sync-overlay-consumer-");
    fs.mkdirSync(path.join(consumer, ".repo/global-settings"), { recursive: true });
    fs.writeFileSync(path.join(consumer, ".repo/global-settings/claude.json"), JSON.stringify({ customKey: 1 }));
    const home = tmpDir("sync-overlay-home-");
    const r = syncGlobals({ workspaceRoot: consumer, sourceRoot: stock, consumerRoot: consumer, home, apply: true, host: "claude" });
    expect(r.ok).toBe(true);
    expect(JSON.parse(fs.readFileSync(path.join(home, ".claude/settings.json"), "utf8"))).toEqual({ customKey: 1 });
  });

  it("falls back to the stock payload when the overlay lacks that file", () => {
    const stock = stockCopy();
    const consumer = tmpDir("sync-overlay-empty-");
    const home = tmpDir("sync-overlay-home-");
    const r = syncGlobals({ workspaceRoot: consumer, sourceRoot: stock, consumerRoot: consumer, home, apply: true, host: "claude" });
    expect(r.ok).toBe(true);
    const stockPayload = JSON.parse(fs.readFileSync(path.join(stock, ".rulesync/global-settings/claude.json"), "utf8")) as Record<string, unknown>;
    const written = JSON.parse(fs.readFileSync(path.join(home, ".claude/settings.json"), "utf8")) as Record<string, unknown>;
    expect(Object.keys(written)).toEqual(expect.arrayContaining(Object.keys(stockPayload).filter((k) => k !== "hooks")));
    expect(written).not.toHaveProperty("customKey");
  });
});
