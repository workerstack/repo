import os from "node:os";

import { afterEach, describe, expect, it, vi } from "vitest";

import { plantStub } from "../__fixtures__/stub-bin.ts";
import { put, realTmp } from "./__fixtures__/doctor-kit.ts";
import { agentModelsLines } from "./agent-models-lines.ts";
import type { ListRunner } from "./doctor.types.ts";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

function tmp(): string {
  return realTmp("doc-agents-");
}

function checkout(files: Record<string, string>) {
  const cwd = tmp();
  for (const [rel, body] of Object.entries(files)) put(cwd, rel, body);
  return cwd;
}

const GROK_LIST = "Available models:\n  * grok-4.7 (default)\n";
function ok(): ReturnType<ListRunner> {
  return Promise.resolve({ code: 0, stderr: "", stdout: GROK_LIST });
}

function failedEmpty(): ReturnType<ListRunner> {
  return Promise.resolve({ code: 3, stderr: "\n", stdout: "" });
}

async function lines(files: Record<string, string>, run: ListRunner = ok, sourceRoot?: string) {
  const cwd = checkout(files);
  const home = tmp();
  const out = await agentModelsLines({ cwd, env: {}, home, run, sourceRoot: sourceRoot ?? cwd });
  return out.join("\n");
}

async function codex(cache: string) {
  const cwd = checkout({ ".codex/agents/a.toml": 'model = "gpt-x"\n' });
  const home = tmp();
  put(home, ".codex/models_cache.json", cache);
  const out = await agentModelsLines({ cwd, env: {}, home, run: ok, sourceRoot: cwd });
  return out.join("\n");
}

describe("agent files with odd contents", () => {
  it("reads nothing from an agent file with no frontmatter or no model", async () => {
    const text = await lines({
      ".codex/agents/c.toml": 'name = "c"\n',
      ".grok/agents/a.md": "no frontmatter here\n",
      ".grok/agents/b.md": "---\nname: b\n---\n",
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
    expect(await lines(grokAgent, failedEmpty)).toContain("grok models failed: exit 3");
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
    plantStub(bin, "grok", {
      cmd: "echo oops 1>&2\necho Available models:\necho   grok-4.7\n",
      sh: 'echo "oops" >&2\necho "Available models:"\necho "  grok-4.7"\n',
    });
    const cwd = tmp();
    vi.stubEnv("PATH", bin);
    vi.spyOn(process, "cwd").mockReturnValue(cwd);
    vi.spyOn(os, "homedir").mockReturnValue(tmp());
    const listed = await agentModelsLines();
    const out = listed.join("\n");
    expect(out).toMatch(/^agent models\s+(ok|\d+ to fix)/);
    expect(out).not.toContain("not installed");
  });

  it("keeps the stderr of a failing CLI in the skip note", async () => {
    const bin = tmp();
    plantStub(bin, "grok", { cmd: "echo bad login 1>&2\nexit /b 2\n", sh: 'echo "bad login" >&2\nexit 2\n' });
    vi.stubEnv("PATH", bin);
    vi.spyOn(process, "cwd").mockReturnValue(tmp());
    vi.spyOn(os, "homedir").mockReturnValue(tmp());
    const listed = await agentModelsLines();
    expect(listed.join("\n")).toContain("grok models failed: bad login");
  });
});
