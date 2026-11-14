import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parse as parseToml } from "smol-toml";
import { afterEach, vi } from "vitest";
import { removeTemps } from "../../__fixtures__/remove-temps.ts";

/** A planted home under the OS temp dir, removed after each case; nothing here touches the real home. */
export function plantHomes(): (prefix: string) => string {
  const dirs: string[] = [];
  afterEach(() => {
    removeTemps(dirs.splice(0));
  });
  return (prefix) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    dirs.push(dir);
    return dir;
  };
}

/** Write `body` at `rel` under `home`, creating parent dirs. */
export function plant(home: string, rel: string, body: string): string {
  const abs = path.join(home, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, body);
  return abs;
}

/** The parts of grok's config a purge reads and writes. */
export interface GrokConfig {
  custom?: { keep?: boolean };
  plugins?: { enabled?: string[]; disabled?: string[] };
  disabled_mcp_servers?: string[];
}

/** The parts of cursor's MCP config and claude's plugin list a purge reads and writes. */
export interface JsonDest {
  mcpServers?: Record<string, unknown>;
  plugins?: Record<string, unknown>;
}

/** Grok's config at `file` as a purge leaves it. */
export function readGrok(file: string): GrokConfig {
  return parseToml(fs.readFileSync(file, "utf8")) /* a purge writes grok's config in this shape */ as GrokConfig;
}

/** A JSON dest at `file` as a purge leaves it. */
export function readJsonDest(file: string): JsonDest {
  return JSON.parse(fs.readFileSync(file, "utf8")) /* the tests plant these dests as objects */ as JsonDest;
}

/** A home with grok enabling cloudflare and, unless `cursor` is false, cursor running MCP_DOCKER beside `keep`. */
export function seedHome(home: string, opts: { cursor?: boolean } = {}): { grok: string; cursor: string } {
  const grok = plant(home, ".grok/config.toml", `[custom]\nkeep = true\n\n[plugins]\nenabled = ["cloudflare"]\n`);
  const cursor = path.join(home, ".cursor", "mcp.json");
  if (opts.cursor !== false) {
    const servers = { mcpServers: { MCP_DOCKER: { command: "docker" }, keep: { command: "x" } } };
    plant(home, ".cursor/mcp.json", JSON.stringify(servers, null, 2) + "\n");
  }
  return { grok, cursor };
}

/** Collect what the code under test writes to stdout and stderr; the caller restores mocks after each case. */
export function captureStreams(): { out: () => string; err: () => string } {
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
  return { out: () => out.join(""), err: () => err.join("") };
}
