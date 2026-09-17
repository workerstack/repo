import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  CLAUDE_TOOL_LIST,
  GENERIC_TOOL_LIST,
  emitAgentShellTools,
  parseArgv,
  splitFrontmatter,
  toClaudeShellBody,
} from "./emit-agent-shell-tools.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");
const script = path.join(here, "emit-agent-shell-tools.mjs");

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

function mdBody(text: string) {
  const split = splitFrontmatter(text);
  if (!split.ok) throw new Error(split.error);
  return split.body;
}

function genericGruntBody() {
  return `Voice: \`.rulesync/reference/output.md\` — must follow.

Tools (shell/host; and more): ${GENERIC_TOOL_LIST}. Git.

You CAN run npm/git/bash via \`run_terminal_command\`. Do NOT wait on MCP. Do NOT request MCP for shell. \`mcpInheritance: none\` means no MCP — use shell/files instead.

\`job: web\` and messy test → LLM grunt (web_search/web_fetch).
`;
}

describe("parseArgv", () => {
  it("defaults and --check", () => {
    expect(parseArgv([])).toEqual({ ok: true, check: false });
    expect(parseArgv(["--check"])).toEqual({ ok: true, check: true });
    expect(parseArgv(["--wat"]).ok).toBe(false);
  });
});

describe("toClaudeShellBody", () => {
  it("maps generic host shell names to Claude Bash only", () => {
    const generic = genericGruntBody();
    const claude = toClaudeShellBody(generic);
    expect(claude).toContain(CLAUDE_TOOL_LIST);
    expect(claude).not.toContain(GENERIC_TOOL_LIST);
    expect(claude).toMatch(/via `Bash`/);
    expect(claude).not.toMatch(/run_terminal_command/);
    expect(claude).toMatch(/WebSearch\/WebFetch/);
    expect(generic).toMatch(/run_terminal_command/);
    expect(generic).not.toMatch(/\bBash\b/);
  });
});

describe("emitAgentShellTools", () => {
  it("rewrites only .claude/agents/grunt.md body; leaves other agents", () => {
    const ws = tmpDir("emit-shell-");
    const ssotDir = path.join(ws, ".rulesync/subagents");
    fs.mkdirSync(ssotDir, { recursive: true });
    const body = genericGruntBody();
    fs.writeFileSync(
      path.join(ssotDir, "grunt.md"),
      `---\nname: grunt\nclaudecode:\n  tools: [Bash]\n---\n${body}`,
    );
    fs.writeFileSync(
      path.join(ssotDir, "implementer.md"),
      "---\nname: implementer\n---\nNever run for simple tool usage.\n",
    );
    fs.mkdirSync(path.join(ws, ".claude/agents"), { recursive: true });
    fs.writeFileSync(
      path.join(ws, ".claude/agents/grunt.md"),
      `---\nname: grunt\nmodel: haiku\ntools:\n  - Bash\n---\n${body}`,
    );
    fs.writeFileSync(
      path.join(ws, ".claude/agents/implementer.md"),
      "---\nname: implementer\n---\nNever run for simple tool usage.\n",
    );
    const r = emitAgentShellTools({ workspaceRoot: ws, check: false });
    expect(r.ok).toBe(true);
    const grunt = fs.readFileSync(path.join(ws, ".claude/agents/grunt.md"), "utf8");
    expect(mdBody(grunt)).toBe(toClaudeShellBody(body));
    expect(mdBody(grunt)).toMatch(/\bBash\b/);
    expect(mdBody(grunt)).not.toMatch(/run_terminal_command/);
    expect(fs.readFileSync(path.join(ws, ".claude/agents/implementer.md"), "utf8")).toBe(
      "---\nname: implementer\n---\nNever run for simple tool usage.\n",
    );
    expect(emitAgentShellTools({ workspaceRoot: ws, check: true }).ok).toBe(true);
  });

  it("check fails when Claude grunt still names run_terminal_command", () => {
    const ws = tmpDir("emit-shell-drift-");
    const ssotDir = path.join(ws, ".rulesync/subagents");
    fs.mkdirSync(ssotDir, { recursive: true });
    const body = genericGruntBody();
    fs.writeFileSync(path.join(ssotDir, "grunt.md"), `---\nname: grunt\n---\n${body}`);
    fs.mkdirSync(path.join(ws, ".claude/agents"), { recursive: true });
    fs.writeFileSync(
      path.join(ws, ".claude/agents/grunt.md"),
      `---\nname: grunt\n---\n${body}`,
    );
    const checked = emitAgentShellTools({ workspaceRoot: ws, check: true });
    expect(checked.ok).toBe(false);
    expect(String(checked.error)).toMatch(/drift/);
  });
});

describe("repo SSOT + emit", () => {
  it("grunt SSOT body is isolation facts; not Bash as host shell", () => {
    const raw = fs.readFileSync(path.join(repoRoot, ".rulesync/subagents/grunt.md"), "utf8");
    const body = mdBody(raw);
    expect(body).toMatch(/isolation facts/);
    expect(body).not.toMatch(/\bBash\b/);
    expect(raw).toMatch(/mcpInheritance:\s*none/);
  });

  it("orchestrator SSOT body does not name Bash as host shell", () => {
    const body = mdBody(
      fs.readFileSync(path.join(repoRoot, ".rulesync/subagents/orchestrator.md"), "utf8"),
    );
    expect(body).not.toMatch(/\bBash\b/);
  });

  it("non-Claude grunt emit uses run_terminal_command; Claude uses Bash", () => {
    const grok = mdBody(
      fs.readFileSync(path.join(repoRoot, ".grok/agents/grunt.md"), "utf8"),
    );
    const gemini = mdBody(
      fs.readFileSync(path.join(repoRoot, ".gemini/agents/grunt/agent.md"), "utf8"),
    );
    const agents = mdBody(
      fs.readFileSync(path.join(repoRoot, ".agents/agents/grunt.md"), "utf8"),
    );
    const claude = mdBody(
      fs.readFileSync(path.join(repoRoot, ".claude/agents/grunt.md"), "utf8"),
    );
    const codex = fs.readFileSync(path.join(repoRoot, ".codex/agents/grunt.toml"), "utf8");
    const ssot = mdBody(
      fs.readFileSync(path.join(repoRoot, ".rulesync/subagents/grunt.md"), "utf8"),
    );
    for (const body of [grok, gemini, agents]) {
      expect(body).toMatch(/isolation facts/);
      expect(body).not.toMatch(/\bBash\b/);
    }
    expect(codex).toMatch(/isolation facts|run_terminal_command/);
    expect(claude).toBe(toClaudeShellBody(ssot));
    expect(grok).toBe(ssot);
  });
});

describe("cli", () => {
  it("unknown flag → stderr + exit 1", () => {
    const cli = spawnSync(process.execPath, [script, "--wat"], {
      encoding: "utf8",
      timeout: 20_000,
    });
    expect(cli.status).toBe(1);
    expect(cli.stderr).toMatch(/unknown flag/);
  });
});
