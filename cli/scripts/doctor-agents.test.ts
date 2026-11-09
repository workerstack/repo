import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { agentModelsLines, type ListRunner } from "./doctor.ts";

const dirs: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

function tmp() {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "doc-agents-")));
  dirs.push(dir);
  return dir;
}

function put(root: string, rel: string, body: string) {
  const file = path.join(root, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body);
}

function checkout(files: Record<string, string>) {
  const cwd = tmp();
  for (const [rel, body] of Object.entries(files)) put(cwd, rel, body);
  return cwd;
}

const GROK_LIST = "Available models:\n  * grok-4.7 (default)\n";
const ok: ListRunner = () => Promise.resolve({ code: 0, stdout: GROK_LIST, stderr: "" });

async function lines(files: Record<string, string>, run: ListRunner = ok, sourceRoot?: string) {
  const cwd = checkout(files);
  const home = tmp();
  return (await agentModelsLines({ cwd, env: {}, home, run, sourceRoot: sourceRoot ?? cwd })).join("\n");
}

describe("agent files with odd contents", () => {
  it("reads nothing from an agent file with no frontmatter or no model", async () => {
    const text = await lines({
      ".grok/agents/a.md": "no frontmatter here\n",
      ".grok/agents/b.md": "---\nname: b\n---\n",
      ".codex/agents/c.toml": 'name = "c"\n',
    });
    expect(text).toMatch(/^agent models\s+ok\s*$/);
  });

  it("reads the grok subagent models from the package globals, up to the next table", async () => {
    const source = checkout({
      "agents/global-settings/grok.toml": [
        "[subagents.models]",
        'scout = "grok-4.7"',
        'worker = "grok-gone"',
        "[other]",
        'ignored = "nope"',
      ].join("\n"),
    });
    const text = await lines({}, ok, source);
    expect(text).toMatch(/1 to fix/);
    expect(text).toContain("- agents/global-settings/grok.toml: model grok-gone is not offered by grok");
    expect(text).not.toContain("nope");
  });
});

describe("grok subagent models in the package globals", () => {
  it("reads the subagent models table when it is the last table", async () => {
    const source = checkout({ "agents/global-settings/grok.toml": '[subagents.models]\nscout = "grok-4.7"\n' });
    expect(await lines({}, ok, source)).toMatch(/^agent models\s+ok\s*$/);
  });

  it("reads no subagent models when the table is absent", async () => {
    const source = checkout({ "agents/global-settings/grok.toml": "[other]\nx = 1\n" });
    expect(await lines({}, ok, source)).toMatch(/^agent models\s+ok\s*$/);
  });
});

describe("codex models cache", () => {
  async function codex(cache: string) {
    const cwd = checkout({ ".codex/agents/a.toml": 'model = "gpt-x"\n' });
    const home = tmp();
    put(home, ".codex/models_cache.json", cache);
    return (await agentModelsLines({ cwd, env: {}, home, run: ok, sourceRoot: cwd })).join("\n");
  }

  it("skips a cache whose models are not records or carry no slug", async () => {
    expect(await codex(JSON.stringify({ models: [1] }))).toContain("codex models cache malformed");
    expect(await codex(JSON.stringify({ models: [{ name: "x" }] }))).toContain("codex models cache malformed");
    expect(await codex(JSON.stringify({ models: "x" }))).toContain("codex models cache malformed");
    expect(await codex("{ nope")).toContain("codex models cache malformed");
  });
});

describe("list command failures", () => {
  const grokAgent = { ".grok/agents/a.md": "---\nmodel: grok-4.7\n---\n" };

  it("reports the exit code when a failed list printed nothing on stderr", async () => {
    const run: ListRunner = () => Promise.resolve({ code: 3, stdout: "", stderr: "\n" });
    expect(await lines(grokAgent, run)).toContain("grok models failed: exit 3");
  });

  it("reports an error that is not a Node error with a code", async () => {
    const text = await lines(grokAgent, () => Promise.reject("boom"));
    expect(text).toContain("grok models failed: boom");
    const other = await lines(grokAgent, () => Promise.reject(Object.assign(new Error("denied"), { code: "EACCES" })));
    expect(other).toContain("grok models failed: denied");
  });
});

describe("with the real list runner and process defaults", () => {
  it("lists through the CLI on PATH and reads the package globals, cwd and home by default", async () => {
    const bin = tmp();
    fs.writeFileSync(
      path.join(bin, "grok"),
      '#!/bin/sh\necho "oops" >&2\necho "Available models:"\necho "  grok-4.7"\n',
      { mode: 0o755 },
    );
    const cwd = tmp();
    vi.stubEnv("PATH", bin);
    vi.spyOn(process, "cwd").mockReturnValue(cwd);
    vi.spyOn(os, "homedir").mockReturnValue(tmp());
    const out = (await agentModelsLines()).join("\n");
    expect(out).toMatch(/^agent models\s+(ok|\d+ to fix)/);
    expect(out).not.toContain("not installed");
  });

  it("keeps the stderr of a failing CLI in the skip note", async () => {
    const bin = tmp();
    fs.writeFileSync(path.join(bin, "grok"), '#!/bin/sh\necho "bad login" >&2\nexit 2\n', { mode: 0o755 });
    vi.stubEnv("PATH", bin);
    vi.spyOn(process, "cwd").mockReturnValue(tmp());
    vi.spyOn(os, "homedir").mockReturnValue(tmp());
    expect((await agentModelsLines()).join("\n")).toContain("grok models failed: bad login");
  });
});
