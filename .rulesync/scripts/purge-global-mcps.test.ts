import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { parse as parseToml } from "smol-toml";
import {
  grokConfigPath,
  parseArgv,
  purgeGlobalMcps,
  cursorMcpPath,
  claudePluginsPath,
  resolveHome,
} from "./purge-global-mcps.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");
const script = path.join(here, "purge-global-mcps.mjs");

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

function seedHome(home: string, opts: { cursor?: boolean } = {}) {
  const grok = grokConfigPath(home);
  fs.mkdirSync(path.dirname(grok), { recursive: true });
  fs.writeFileSync(
    grok,
    `[custom]\nkeep = true\n\n[plugins]\nenabled = ["cloudflare"]\n`,
  );
  if (opts.cursor !== false) {
    const cursor = cursorMcpPath(home);
    fs.mkdirSync(path.dirname(cursor), { recursive: true });
    fs.writeFileSync(
      cursor,
      JSON.stringify(
        { mcpServers: { MCP_DOCKER: { command: "docker" }, keep: { command: "x" } } },
        null,
        2,
      ) + "\n",
    );
  }
  return { grok, cursor: cursorMcpPath(home) };
}

describe("parseArgv", () => {
  it("defaults dry-run; --apply writes", () => {
    expect(parseArgv([])).toEqual({ ok: true, apply: false });
    expect(parseArgv(["--apply"])).toEqual({ ok: true, apply: true });
    expect(parseArgv(["--wat"]).ok).toBe(false);
  });
});

describe("resolveHome", () => {
  it("HOME beats USERPROFILE", () => {
    expect(resolveHome({ HOME: "/unix", USERPROFILE: "C:\\Users\\x" })).toBe(
      "/unix",
    );
  });

  it("USERPROFILE when HOME unset (Windows env sim)", () => {
    expect(resolveHome({ USERPROFILE: "C:\\Users\\win" })).toBe("C:\\Users\\win");
  });

  it("falls back to os.homedir when env empty", () => {
    expect(resolveHome({})).toBe(os.homedir());
  });
});

describe("purgeGlobalMcps", () => {
  it("dry-run leaves files unchanged", () => {
    const home = tmpDir("purge-mcp-dry-");
    const { grok, cursor } = seedHome(home);
    const grokBefore = fs.readFileSync(grok, "utf8");
    const cursorBefore = fs.readFileSync(cursor, "utf8");
    const r = purgeGlobalMcps({ home, apply: false });
    expect(r.ok).toBe(true);
    expect(r.report.every((row: { action: string }) => row.action === "dry-run")).toBe(
      true,
    );
    expect(fs.readFileSync(grok, "utf8")).toBe(grokBefore);
    expect(fs.readFileSync(cursor, "utf8")).toBe(cursorBefore);
  });

  it("--apply removes cloudflare from enabled, adds disabled, drops MCP_DOCKER", () => {
    const home = tmpDir("purge-mcp-apply-");
    const { grok, cursor } = seedHome(home);
    const r = purgeGlobalMcps({ home, apply: true });
    expect(r.ok).toBe(true);
    expect(r.report.every((row: { action: string }) => row.action === "apply")).toBe(
      true,
    );
    const parsed = parseToml(fs.readFileSync(grok, "utf8")) as {
      custom?: { keep?: boolean };
      plugins?: { enabled?: string[]; disabled?: string[] };
      disabled_mcp_servers?: string[];
    };
    expect(parsed.custom?.keep).toBe(true);
    expect(parsed.plugins?.enabled || []).not.toContain("cloudflare");
    expect(parsed.plugins?.enabled || []).not.toContain("stripe");
    expect(parsed.plugins?.disabled).toContain("cloudflare");
    expect(parsed.plugins?.disabled).toContain("stripe");
    expect(parsed.disabled_mcp_servers).toEqual(
      expect.arrayContaining(["cloudflare-docs", "MCP_DOCKER", "stripe"]),
    );
    const mcp = JSON.parse(fs.readFileSync(cursor, "utf8"));
    expect(mcp.mcpServers.MCP_DOCKER).toBeUndefined();
    expect(mcp.mcpServers.keep).toEqual({ command: "x" });
    expect(fs.readFileSync(cursor, "utf8").endsWith("\n")).toBe(true);
  });

  it("missing cursor file: still succeeds only grok side changes", () => {
    const home = tmpDir("purge-mcp-nocursor-");
    const { grok, cursor } = seedHome(home, { cursor: false });
    expect(fs.existsSync(cursor)).toBe(false);
    const r = purgeGlobalMcps({ home, apply: true });
    expect(r.ok).toBe(true);
    expect(fs.existsSync(cursor)).toBe(false);
    const parsed = parseToml(fs.readFileSync(grok, "utf8")) as {
      plugins?: { enabled?: string[]; disabled?: string[] };
    };
    expect(parsed.plugins?.enabled || []).not.toContain("cloudflare");
    expect(parsed.plugins?.disabled).toContain("cloudflare");
    expect(r.report.some((row: { detail: string }) => /missing/.test(row.detail))).toBe(
      true,
    );
  });

  it("does not touch a fixture project .grok/config.toml", () => {
    const home = tmpDir("purge-mcp-home-");
    const ws = tmpDir("purge-mcp-ws-");
    seedHome(home);
    const projectCfg = path.join(ws, ".grok", "config.toml");
    fs.mkdirSync(path.dirname(projectCfg), { recursive: true });
    const projectBody = `[plugins]\nenabled = ["cloudflare"]\n`;
    fs.writeFileSync(projectCfg, projectBody);
    const r = spawnSync(process.execPath, [script, "--apply"], {
      encoding: "utf8",
      cwd: ws,
      timeout: 20_000,
      env: { ...process.env, HOME: home },
    });
    expect(r.status).toBe(0);
    expect(fs.readFileSync(projectCfg, "utf8")).toBe(projectBody);
    const parsed = parseToml(fs.readFileSync(grokConfigPath(home), "utf8")) as {
      plugins?: { enabled?: string[] };
    };
    expect(parsed.plugins?.enabled || []).not.toContain("cloudflare");
  });

  it("unreadable toml fails without write", () => {
    const home = tmpDir("purge-mcp-unread-");
    const grok = grokConfigPath(home);
    fs.mkdirSync(path.dirname(grok), { recursive: true });
    const original = "<<<not-toml>>>\nkeep-this\n";
    fs.writeFileSync(grok, original);
    const r = purgeGlobalMcps({ home, apply: true });
    expect(r.ok).toBe(false);
    expect(fs.readFileSync(grok, "utf8")).toBe(original);
  });

  it("empties cursor mcpServers to {}", () => {
    const home = tmpDir("purge-mcp-empty-");
    const grok = grokConfigPath(home);
    fs.mkdirSync(path.dirname(grok), { recursive: true });
    fs.writeFileSync(grok, `[plugins]\nenabled = ["other"]\n`);
    const cursor = cursorMcpPath(home);
    fs.mkdirSync(path.dirname(cursor), { recursive: true });
    fs.writeFileSync(
      cursor,
      JSON.stringify({ mcpServers: { MCP_DOCKER: { command: "docker" } } }, null, 2) +
        "\n",
    );
    expect(purgeGlobalMcps({ home, apply: true }).ok).toBe(true);
    expect(JSON.parse(fs.readFileSync(cursor, "utf8"))).toEqual({ mcpServers: {} });
  });

  it("--apply removes stripe from enabled, adds disabled + disabled_mcp_servers; cloudflare unchanged", () => {
    const home = tmpDir("purge-mcp-stripe-");
    const grok = grokConfigPath(home);
    fs.mkdirSync(path.dirname(grok), { recursive: true });
    fs.writeFileSync(
      grok,
      `[custom]\nkeep = true\n\n[plugins]\nenabled = ["cloudflare", "stripe", "keep"]\ndisabled = ["cloudflare"]\n\ndisabled_mcp_servers = ["cloudflare-docs", "MCP_DOCKER"]\n`,
    );
    const r = purgeGlobalMcps({ home, apply: true });
    expect(r.ok).toBe(true);
    const parsed = parseToml(fs.readFileSync(grok, "utf8")) as {
      custom?: { keep?: boolean };
      plugins?: { enabled?: string[]; disabled?: string[] };
      disabled_mcp_servers?: string[];
    };
    expect(parsed.custom?.keep).toBe(true);
    expect(parsed.plugins?.enabled).toEqual(["keep"]);
    expect(parsed.plugins?.disabled).toEqual(["cloudflare", "stripe"]);
    expect(parsed.disabled_mcp_servers).toEqual([
      "cloudflare-docs",
      "MCP_DOCKER",
      "stripe",
    ]);
    expect(r.report.some((row: { detail: string }) => /stripe/.test(row.detail))).toBe(
      true,
    );
  });

  it("removes stripe@ marketplace key from claude installed_plugins.json; leaves cache", () => {
    const home = tmpDir("purge-mcp-claude-");
    const grok = grokConfigPath(home);
    fs.mkdirSync(path.dirname(grok), { recursive: true });
    fs.writeFileSync(grok, `[plugins]\nenabled = ["other"]\n`);
    const claude = claudePluginsPath(home);
    fs.mkdirSync(path.dirname(claude), { recursive: true });
    const cacheDir = path.join(path.dirname(claude), "cache", "claude-plugins-official", "stripe", "0.6.2");
    fs.mkdirSync(cacheDir, { recursive: true });
    fs.writeFileSync(path.join(cacheDir, "marker"), "keep");
    fs.writeFileSync(
      claude,
      JSON.stringify(
        {
          version: 2,
          plugins: {
            "keep@claude-plugins-official": [{ scope: "user" }],
            "stripe@claude-plugins-official": [{ scope: "user", installPath: cacheDir }],
          },
        },
        null,
        2,
      ) + "\n",
    );
    const r = purgeGlobalMcps({ home, apply: true });
    expect(r.ok).toBe(true);
    const parsed = JSON.parse(fs.readFileSync(claude, "utf8"));
    expect(parsed.plugins["stripe@claude-plugins-official"]).toBeUndefined();
    expect(parsed.plugins["keep@claude-plugins-official"]).toEqual([{ scope: "user" }]);
    expect(fs.readFileSync(path.join(cacheDir, "marker"), "utf8")).toBe("keep");
    expect(r.report.some((row: { path: string }) => row.path === claude)).toBe(true);
  });

  it("claude plugins missing: grok stripe still disabled", () => {
    const home = tmpDir("purge-mcp-noclaude-");
    const grok = grokConfigPath(home);
    fs.mkdirSync(path.dirname(grok), { recursive: true });
    fs.writeFileSync(grok, `[plugins]\nenabled = ["stripe"]\n`);
    expect(fs.existsSync(claudePluginsPath(home))).toBe(false);
    expect(purgeGlobalMcps({ home, apply: true }).ok).toBe(true);
    const parsed = parseToml(fs.readFileSync(grok, "utf8")) as {
      plugins?: { enabled?: string[]; disabled?: string[] };
      disabled_mcp_servers?: string[];
    };
    expect(parsed.plugins?.enabled || []).not.toContain("stripe");
    expect(parsed.plugins?.disabled).toContain("stripe");
    expect(parsed.disabled_mcp_servers).toContain("stripe");
    expect(fs.existsSync(claudePluginsPath(home))).toBe(false);
  });
});

describe("CLI", () => {
  it("bad args exit 1", () => {
    const r = spawnSync(process.execPath, [script, "--nope"], {
      encoding: "utf8",
      cwd: repoRoot,
      timeout: 20_000,
      env: { ...process.env, HOME: tmpDir("purge-mcp-cli-bad-") },
    });
    expect(r.status).toBe(1);
  });

  it("smoke: dry-run with fake HOME", () => {
    const home = tmpDir("purge-mcp-cli-");
    seedHome(home);
    const grokBefore = fs.readFileSync(grokConfigPath(home), "utf8");
    const r = spawnSync(process.execPath, [script], {
      encoding: "utf8",
      cwd: repoRoot,
      timeout: 20_000,
      env: { ...process.env, HOME: home },
    });
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/dry-run/);
    expect(fs.readFileSync(grokConfigPath(home), "utf8")).toBe(grokBefore);
  });

  it("CLI: USERPROFILE without HOME (Windows env sim)", () => {
    const home = tmpDir("purge-mcp-userprofile-");
    seedHome(home);
    const grokBefore = fs.readFileSync(grokConfigPath(home), "utf8");
    const env = { ...process.env, USERPROFILE: home };
    delete env.HOME;
    const r = spawnSync(process.execPath, [script], {
      encoding: "utf8",
      cwd: repoRoot,
      timeout: 20_000,
      env,
    });
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/dry-run/);
    expect(r.stdout).toContain(grokConfigPath(home));
    expect(fs.readFileSync(grokConfigPath(home), "utf8")).toBe(grokBefore);
  });
});
