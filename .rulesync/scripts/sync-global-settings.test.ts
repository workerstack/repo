import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { parse as parseToml } from "smol-toml";
import {
  deepMerge,
  parseArgv,
  resolveDest,
  shouldSkip,
  syncGlobals,
} from "./sync-global-settings.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");
const script = path.join(here, "sync-global-settings.mjs");
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
    expect(parseArgv(["--host", "nope"]).ok).toBe(false);
    expect(parseArgv(["--host=nope"]).ok).toBe(false);
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
    const merged = deepMerge(dest, source, skipRe);
    expect(merged.keepMe).toBe(1);
    expect(merged.apiKey).toBe("dest-secret");
    expect(merged.mcp).toEqual({ servers: { old: true } });
    expect(merged.hooks).toBeUndefined();
    expect(merged.features.two_pass_compaction).toBe(true);
    expect(merged.features.hooks).toBe("dest-hooks");
    expect(merged.agent).toEqual({ name: "orchestrator" });
  });
});

describe("syncGlobals", () => {
  it("grok dry-run does not write", () => {
    const home = tmpDir("sync-globals-dry-");
    const r = syncGlobals({
      workspaceRoot: repoRoot,
      home,
      apply: false,
      host: "grok",
    });
    expect(r.ok).toBe(true);
    expect(r.report.some((row: { action: string }) => row.action === "dry-run")).toBe(
      true,
    );
    expect(fs.existsSync(path.join(home, ".grok/config.toml"))).toBe(false);
  });

  it("grok apply creates merged config under fake home", () => {
    const home = tmpDir("sync-globals-apply-");
    const r = syncGlobals({
      workspaceRoot: repoRoot,
      home,
      apply: true,
      host: "grok",
    });
    expect(r.ok).toBe(true);
    const dest = path.join(home, ".grok/config.toml");
    expect(fs.existsSync(dest)).toBe(true);
    const parsed = parseToml(fs.readFileSync(dest, "utf8")) as {
      features?: { two_pass_compaction?: boolean };
    };
    expect(parsed.features?.two_pass_compaction).toBe(true);
  });

  it("dest-only keys survive apply", () => {
    const home = tmpDir("sync-globals-keep-");
    const dest = path.join(home, ".grok/config.toml");
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, "[custom]\nkeep = true\n");
    const r = syncGlobals({
      workspaceRoot: repoRoot,
      home,
      apply: true,
      host: "grok",
    });
    expect(r.ok).toBe(true);
    const parsed = parseToml(fs.readFileSync(dest, "utf8")) as {
      custom?: { keep?: boolean };
      features?: { two_pass_compaction?: boolean };
    };
    expect(parsed.custom?.keep).toBe(true);
    expect(parsed.features?.two_pass_compaction).toBe(true);
  });

  it("unreadable dest fails without clobber", () => {
    const home = tmpDir("sync-globals-unread-");
    const dest = path.join(home, ".grok/config.toml");
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const original = "<<<not-toml>>>\nkeep-this\n";
    fs.writeFileSync(dest, original);
    const r = syncGlobals({
      workspaceRoot: repoRoot,
      home,
      apply: true,
      host: "grok",
    });
    expect(r.ok).toBe(false);
    expect(fs.readFileSync(dest, "utf8")).toBe(original);
  });

  it("noop hosts with --apply write nothing under fake home", () => {
    for (const host of ["claude", "codex", "antigravity"] as const) {
      const home = tmpDir(`sync-globals-${host}-`);
      const r = syncGlobals({
        workspaceRoot: repoRoot,
        home,
        apply: true,
        host,
      });
      expect(r.ok).toBe(true);
      expect(fs.readdirSync(home)).toEqual([]);
    }
  });
});

describe("CLI", () => {
  it("smoke: dry-run with fake HOME", () => {
    const home = tmpDir("sync-globals-cli-");
    const r = spawnSync(process.execPath, [script], {
      encoding: "utf8",
      cwd: repoRoot,
      timeout: 20_000,
      env: { ...process.env, HOME: home },
    });
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/dry-run/);
    expect(r.stdout).toMatch(/grok/);
    expect(r.stdout).toMatch(/noop/);
    expect(fs.existsSync(path.join(home, ".grok/config.toml"))).toBe(false);
  });
});
