import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parse as parseToml, stringify as stringifyToml } from "smol-toml";
import { describe, expect, it } from "vitest";

import { bunPath } from "../../dev/test-paths";
import { childEnv } from "../env.ts";
import { tempDir, useTempDirs } from "../sync/fixtures/temp-dirs.ts";
import { deepMerge, parseArgv, resolveDest, shouldSkip, syncGlobals } from "./sync-global-settings.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");
const repoCli = path.join(here, "..", "..", "bin", "repo.ts");
const skipRe = new RegExp(
  "^(secrets?|api[_-]?key|access[_-]?token|tokens?|passwords?|authorization|mcp(servers)?|hooks)$",
  "i",
);

useTempDirs();

const tmpDir = tempDir;

describe("parseArgv", () => {
  it("applies by default and reads --dry-run, --check and --host", () => {
    expect(parseArgv([])).toStrictEqual({ check: false, dryRun: false, host: "all", ok: true });
    expect(parseArgv(["--dry-run"])).toMatchObject({ dryRun: true, ok: true });
    expect(parseArgv(["--check", "--host", "grok"])).toMatchObject({ check: true, host: "grok", ok: true });
    expect(parseArgv(["--host=claude"])).toMatchObject({ host: "claude", ok: true });
  });

  it("rejects a bad host or flag, and --check with --dry-run", () => {
    expect(parseArgv(["--host="])).toStrictEqual({ error: "unknown host: ", ok: false });
    expect(parseArgv(["--apply"])).toStrictEqual({ error: "unknown flag: --apply", ok: false });
    expect(parseArgv(["--host"]).ok).toBe(false);
    expect(parseArgv(["--check", "--dry-run"])).toStrictEqual({
      error: "--check and --dry-run do not combine",
      ok: false,
    });
  });
});

describe("resolveDest", () => {
  it("rejects dest outside home", () => {
    const home = path.join(os.tmpdir(), "yolo-home");
    expect(() => resolveDest(home, "../.ssh/config")).toThrow();
    expect(() => resolveDest(home, "/etc/passwd")).toThrow();
    expect(resolveDest(home, ".grok/config.toml")).toBe(path.resolve(home, ".grok/config.toml"));
  });
});

describe("deepMerge", () => {
  it("keeps dest-only keys and skips mcp/hooks/apiKey", () => {
    expect(shouldSkip("hooks", skipRe)).toBe(true);
    expect(shouldSkip("mcp", skipRe)).toBe(true);
    expect(shouldSkip("apiKey", skipRe)).toBe(true);
    expect(shouldSkip("features", skipRe)).toBe(false);
    const dest = {
      apiKey: "dest-secret",
      features: {
        hooks: "dest-hooks",
        two_pass_compaction: false,
      },
      keepMe: 1,
      mcp: { servers: { old: true } },
    };
    const source = {
      agent: { name: "orchestrator" },
      apiKey: "src-secret",
      features: {
        hooks: "src-hooks",
        two_pass_compaction: true,
      },
      hooks: { on: true },
      mcp: { servers: { new: true } },
    };
    const merged = deepMerge(dest, source, skipRe) as Record<string, unknown> & {
      features: { two_pass_compaction: boolean; hooks: string };
    };
    expect(merged.keepMe).toBe(1);
    expect(merged.apiKey).toBe("dest-secret");
    expect(merged.mcp).toStrictEqual({ servers: { old: true } });
    expect(merged.hooks).toBeUndefined();
    expect(merged.features.two_pass_compaction).toBe(true);
    expect(merged.features.hooks).toBe("dest-hooks");
    expect(merged.agent).toStrictEqual({ name: "orchestrator" });
  });
});

const HOSTS = [
  { dest: ".grok/config.toml", format: "toml", id: "grok" },
  { dest: ".claude/settings.json", format: "json", id: "claude" },
  { dest: ".codex/config.toml", format: "toml", id: "codex" },
  { dest: ".gemini/antigravity-cli/settings.json", format: "json", id: "antigravity" },
  { dest: ".cursor/cli-config.json", format: "json", id: "cursor" },
] as const;

const CLAUDE = HOSTS[1];

/** The keys the tests read back from a written dest; each host's file holds only its own. */
type DestShape = {
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
};

function readDest(home: string, h: { dest: string; format: string }): DestShape {
  const raw = fs.readFileSync(path.join(home, h.dest), "utf8");
  return (h.format === "json" ? JSON.parse(raw) : parseToml(raw)) as DestShape;
}

function writeDest(home: string, h: { dest: string; format: string }, value: object) {
  const abs = path.join(home, h.dest);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, h.format === "json" ? JSON.stringify(value) : stringifyToml(value));
}

/** Workspace with the real manifest and only the payload files named in `payloads`. */
function tmpWorkspace(payloads: string[]) {
  const ws = tmpDir("yolo-ws-");
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

describe("syncGlobals", () => {
  it("reports `{action} {id} {dest}` per host in manifest order", () => {
    const home = tmpDir("yolo-dry-");
    const r = syncGlobals({ apply: false, home, workspaceRoot: repoRoot });
    expect(r.ok).toBe(true);
    expect(r.report.map((row: { line: string }) => row.line)).toStrictEqual(
      HOSTS.map((h) => `dry-run ${h.id} ${h.dest}`),
    );
    const applied = syncGlobals({
      apply: true,
      home: tmpDir("yolo-line-"),
      host: "cursor",
      workspaceRoot: repoRoot,
    });
    expect(applied.report.map((row: { line: string }) => row.line)).toStrictEqual([
      "apply cursor .cursor/cli-config.json",
    ]);
  });

  it("dry-run writes nothing under home", () => {
    const home = tmpDir("yolo-dry-none-");
    const r = syncGlobals({ apply: false, home, workspaceRoot: repoRoot });
    expect(r.ok).toBe(true);
    expect(fs.readdirSync(home)).toStrictEqual([]);
  });

  it.each(HOSTS)("$id: apply creates a missing dest from the payload", (h) => {
    const home = tmpDir(`yolo-create-${h.id}-`);
    const r = syncGlobals({ apply: true, home, host: h.id, workspaceRoot: repoRoot });
    expect(r.ok).toBe(true);
    const manifest = JSON.parse(
      fs.readFileSync(path.join(repoRoot, "agents/global-settings/manifest.json"), "utf8"),
    ) as { hosts: { id: string; payload: string }[] };
    const payloadRel = manifest.hosts.find((x) => x.id === h.id)!.payload; // every HOSTS id is in the manifest
    const raw = fs.readFileSync(path.join(repoRoot, payloadRel), "utf8");
    const payload = h.format === "json" ? JSON.parse(raw) : parseToml(raw);
    expect(readDest(home, h)).toStrictEqual(payload);
  });

  it("writes the Usage keys for every host", () => {
    const home = tmpDir("yolo-usage-");
    expect(syncGlobals({ apply: true, home, workspaceRoot: repoRoot }).ok).toBe(true);
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
    const home = tmpDir(`yolo-keep-${h.id}-`);
    writeDest(home, h, { approvalMode: "ask", keepMe: { nested: true } });
    const r = syncGlobals({ apply: true, home, host: h.id, workspaceRoot: repoRoot });
    expect(r.ok).toBe(true);
    const out = readDest(home, h);
    expect(out.keepMe).toEqual({ nested: true });
    if (h.id === "cursor") expect(out.approvalMode).toBe("unrestricted");
  });

  it("keeps sibling keys inside a merged table", () => {
    const home = tmpDir("yolo-sibling-");
    writeDest(home, CLAUDE, { permissions: { allow: ["Bash(ls)"], defaultMode: "default" } });
    expect(syncGlobals({ apply: true, home, host: "claude", workspaceRoot: repoRoot }).ok).toBe(true);
    expect(readDest(home, CLAUDE).permissions).toStrictEqual({
      allow: ["Bash(ls)"],
      defaultMode: "bypassPermissions",
    });
  });

  it("a repeated apply is idempotent", () => {
    const home = tmpDir("yolo-idem-");
    syncGlobals({ apply: true, home, workspaceRoot: repoRoot });
    const first = HOSTS.map((h) => fs.readFileSync(path.join(home, h.dest), "utf8"));
    syncGlobals({ apply: true, home, workspaceRoot: repoRoot });
    expect(HOSTS.map((h) => fs.readFileSync(path.join(home, h.dest), "utf8"))).toStrictEqual(first);
  });

  it("rejects an unknown host", () => {
    const r = syncGlobals({ home: tmpDir("yolo-bad-"), host: "gemini", workspaceRoot: repoRoot });
    expect(r).toMatchObject({ error: "unknown host: gemini", ok: false });
  });

  it("a deleted payload errors with its repo-relative path and writes nothing", () => {
    const ws = tmpWorkspace([
      "agents/global-settings/claude.json",
      "agents/global-settings/codex.toml",
      "agents/global-settings/grok.toml",
      "agents/global-settings/antigravity.json",
    ]);
    const home = tmpDir("yolo-missing-");
    const r = syncGlobals({ apply: true, home, workspaceRoot: ws });
    expect(r).toMatchObject({
      error: "missing payload: agents/global-settings/cursor.json",
      ok: false,
    });
    expect(r.report.map((row: { id: string }) => row.id)).toStrictEqual(["grok", "claude", "codex", "antigravity"]);
  });

  it("an unparseable payload errors", () => {
    const ws = tmpWorkspace([
      "agents/global-settings/claude.json",
      "agents/global-settings/codex.toml",
      "agents/global-settings/grok.toml",
      "agents/global-settings/antigravity.json",
      "agents/global-settings/cursor.json",
    ]);
    fs.writeFileSync(path.join(ws, "agents/global-settings/claude.json"), "{nope");
    const r = syncGlobals({ home: tmpDir("yolo-badpayload-"), host: "claude", workspaceRoot: ws });
    expect(r).toMatchObject({
      error: "unreadable payload: agents/global-settings/claude.json",
      ok: false,
    });
  });

  it("unreadable toml dest fails without clobber", () => {
    const home = tmpDir("yolo-unread-");
    const dest = path.join(home, ".grok/config.toml");
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const original = "<<<not-toml>>>\nkeep-this\n";
    fs.writeFileSync(dest, original);
    const r = syncGlobals({ apply: true, home, host: "grok", workspaceRoot: repoRoot });
    expect(r.ok).toBe(false);
    expect(fs.readFileSync(dest, "utf8")).toBe(original);
  });

  it("unreadable json dest fails without clobber", () => {
    const home = tmpDir("yolo-unread-json-");
    const dest = path.join(home, ".claude/settings.json");
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, "{broken");
    const r = syncGlobals({ apply: true, home, host: "claude", workspaceRoot: repoRoot });
    expect(r).toMatchObject({ error: "unreadable dest: .claude/settings.json", ok: false });
    expect(fs.readFileSync(dest, "utf8")).toBe("{broken");
  });

  it("an empty json dest is treated as empty", () => {
    const home = tmpDir("yolo-empty-json-");
    const dest = path.join(home, ".claude/settings.json");
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, "  \n");
    expect(syncGlobals({ apply: true, home, host: "claude", workspaceRoot: repoRoot }).ok).toBe(true);
    expect(readDest(home, CLAUDE).permissions.defaultMode).toBe("bypassPermissions");
  });
});

function runCli(args: string[], home: string, cwd: string = repoRoot) {
  return spawnSync(bunPath(), [repoCli, "yolo", ...args], {
    cwd,
    encoding: "utf8",
    env: childEnv({ HOME: home }),
    timeout: 20_000,
  });
}

const HINT = "run `bun repo yolo`";
const ALL_OK = "grok ok · claude ok · codex ok · antigravity ok · cursor ok";

/** A cwd with no manifest but a clean project grok config, so --check has nothing else to complain about. */
function bareCwd() {
  const cwd = tmpDir("yolo-cwd-");
  fs.mkdirSync(path.join(cwd, ".grok"));
  fs.writeFileSync(path.join(cwd, ".grok/config.toml"), "[plugins]\nenabled = []\n");
  return cwd;
}

describe("CLI", () => {
  it("applies by default and prints one apply line per host", () => {
    const home = tmpDir("yolo-cli-");
    const r = runCli([], home, bareCwd());
    expect(r.status).toBe(0);
    expect(r.stdout.trim().split("\n")).toStrictEqual(HOSTS.map((h) => `apply ${h.id} ${h.dest}`));
    for (const h of HOSTS) expect(fs.existsSync(path.join(home, h.dest))).toBe(true);
  });

  it("--dry-run prints dry-run lines and writes nothing", () => {
    const home = tmpDir("yolo-cli-dry-");
    const r = runCli(["--dry-run"], home);
    expect(r.status).toBe(0);
    expect(r.stdout.trim().split("\n")).toStrictEqual(HOSTS.map((h) => `dry-run ${h.id} ${h.dest}`));
    expect(fs.readdirSync(home)).toStrictEqual([]);
  });

  it("--host gemini exits 1 with unknown host", () => {
    const r = runCli(["--host", "gemini"], tmpDir("yolo-cli-bad-"));
    expect(r.status).toBe(1);
    expect(r.stderr.trim()).toBe("unknown host: gemini");
  });

  it("--apply is an unknown flag", () => {
    const r = runCli(["--apply"], tmpDir("yolo-cli-apply-"));
    expect(r.status).toBe(1);
    expect(r.stderr.trim()).toBe("unknown flag: --apply");
  });

  it("--check with --dry-run exits 1 and says they do not combine", () => {
    const r = runCli(["--check", "--dry-run"], tmpDir("yolo-cli-both-"));
    expect(r.status).toBe(1);
    expect(r.stderr.trim()).toBe("--check and --dry-run do not combine");
  });

  it("--check on an empty home lists every host missing, then the hint, and exits 1", () => {
    const r = runCli(["--check"], tmpDir("yolo-cli-empty-"), bareCwd());
    expect(r.status).toBe(1);
    const [line, hint, ...rest] = r.stdout.trim().split("\n");
    expect(rest).toStrictEqual([]);
    expect(hint).toBe(HINT);
    const parts = line!.split(" · ");
    expect(parts.map((p) => p.split(" ")[0])).toStrictEqual(HOSTS.map((h) => h.id));
    for (const p of parts) expect(p).toMatch(/^\w+ missing [\w.-]+(,[\w.-]+)*$/);
    expect(parts[0]).toContain("ui.permission_mode");
  });

  it("--check after an apply prints every host ok and exits 0, without the hint", () => {
    const home = tmpDir("yolo-cli-ok-");
    const cwd = bareCwd();
    expect(runCli([], home, cwd).status).toBe(0);
    const r = runCli(["--check"], home, cwd);
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe(ALL_OK);
    expect(r.stderr).toBe("");
  });

  it("--check names a changed key as differs", () => {
    const home = tmpDir("yolo-cli-differs-");
    const cwd = bareCwd();
    runCli([], home, cwd);
    const file = path.join(home, ".claude/settings.json");
    const v = JSON.parse(fs.readFileSync(file, "utf8")) as { permissions: { defaultMode: string } };
    v.permissions.defaultMode = "default";
    fs.writeFileSync(file, JSON.stringify(v));
    const r = runCli(["--check"], home, cwd);
    expect(r.status).toBe(1);
    expect(r.stdout.trim().split("\n")).toStrictEqual([
      "grok ok · claude differs permissions.defaultMode · codex ok · antigravity ok · cursor ok",
      HINT,
    ]);
  });

  it("--check marks an unparseable dest unreadable for that host only", () => {
    const home = tmpDir("yolo-cli-unreadable-");
    const cwd = bareCwd();
    runCli([], home, cwd);
    fs.writeFileSync(path.join(home, ".claude/settings.json"), "{broken");
    const r = runCli(["--check"], home, cwd);
    expect(r.status).toBe(1);
    expect(r.stdout.trim().split("\n")[0]).toBe("grok ok · claude unreadable · codex ok · antigravity ok · cursor ok");
  });

  it("--check --host claude prints that one host", () => {
    const r = runCli(["--check", "--host", "claude"], tmpDir("yolo-cli-one-"), bareCwd());
    expect(r.status).toBe(1);
    const line = r.stdout.trim().split("\n")[0]!;
    expect(line).toMatch(/^claude missing /);
    expect(line).not.toContain(" · ");
  });

  it("--check reports a bad project grok config after the host line", () => {
    const home = tmpDir("yolo-cli-project-");
    const cwd = bareCwd();
    runCli([], home, cwd);
    fs.writeFileSync(path.join(cwd, ".grok/config.toml"), "[features]\nx = 1\n");
    const r = runCli(["--check"], home, cwd);
    expect(r.status).toBe(1);
    expect(r.stdout.trim()).toBe(ALL_OK);
    expect(r.stderr.trim()).toBe("project .grok/config.toml must not set [features] or [agent]");
  });
});

describe("sourceRoot", () => {
  it("reads manifest and payloads from the source root, never needing them in the workspace", () => {
    const stock = tmpDir("sync-stock-");
    fs.cpSync(path.join(repoRoot, "agents/global-settings"), path.join(stock, "agents/global-settings"), {
      recursive: true,
    });
    const out = tmpDir("sync-out-");
    const home = tmpDir("sync-home-");
    const r = syncGlobals({ apply: true, home, sourceRoot: stock, workspaceRoot: out });
    expect(r.ok).toBe(true);
    expect(r.report.length).toBeGreaterThan(0);
    expect(fs.readdirSync(out)).toStrictEqual([]);
    expect(fs.readdirSync(stock)).toStrictEqual(["agents"]);
    expect(fs.existsSync(path.join(home, ".grok/config.toml"))).toBe(true);
  });
});

describe("consumerRoot overlay", () => {
  function stockCopy() {
    const stock = tmpDir("sync-overlay-stock-");
    fs.cpSync(path.join(repoRoot, "agents/global-settings"), path.join(stock, "agents/global-settings"), {
      recursive: true,
    });
    return stock;
  }

  it("a payload under .repo/global-settings replaces the stock one whole", () => {
    const stock = stockCopy();
    const consumer = tmpDir("sync-overlay-consumer-");
    fs.mkdirSync(path.join(consumer, ".repo/global-settings"), { recursive: true });
    fs.writeFileSync(path.join(consumer, ".repo/global-settings/claude.json"), JSON.stringify({ customKey: 1 }));
    const home = tmpDir("sync-overlay-home-");
    const r = syncGlobals({
      apply: true,
      consumerRoot: consumer,
      home,
      host: "claude",
      sourceRoot: stock,
      workspaceRoot: consumer,
    });
    expect(r.ok).toBe(true);
    expect(JSON.parse(fs.readFileSync(path.join(home, ".claude/settings.json"), "utf8"))).toStrictEqual({
      customKey: 1,
    });
  });

  it("falls back to the stock payload when the overlay lacks that file", () => {
    const stock = stockCopy();
    const consumer = tmpDir("sync-overlay-empty-");
    const home = tmpDir("sync-overlay-home-");
    const r = syncGlobals({
      apply: true,
      consumerRoot: consumer,
      home,
      host: "claude",
      sourceRoot: stock,
      workspaceRoot: consumer,
    });
    expect(r.ok).toBe(true);
    const stockPayload = JSON.parse(
      fs.readFileSync(path.join(stock, "agents/global-settings/claude.json"), "utf8"),
    ) as Record<string, unknown>;
    const written = JSON.parse(fs.readFileSync(path.join(home, ".claude/settings.json"), "utf8")) as Record<
      string,
      unknown
    >;
    expect(Object.keys(written)).toStrictEqual(
      expect.arrayContaining(Object.keys(stockPayload).filter((k) => k !== "hooks")),
    );
    expect(written).not.toHaveProperty("customKey");
  });
});
