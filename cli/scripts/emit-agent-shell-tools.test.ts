import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, expect, it, vi } from "vitest";

import {
  CLAUDE_TOOL_LIST,
  GENERIC_TOOL_LIST,
  emitAgentShellTools,
  splitFrontmatter,
  toClaudeShellBody,
} from "./emit-agent-shell-tools.ts";
import { cleanTemps, tempDir } from "./fixtures/turn-repo.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");

afterEach(() => {
  vi.restoreAllMocks();
  cleanTemps();
});

function mdBody(text: string) {
  const split = splitFrontmatter(text);
  if (!split.ok) throw new Error(split.error);
  return split.body;
}

function genericManagedBody() {
  return [
    "Voice: `node_modules/@workerstack/repo/references/output.md` — must follow.",
    "",
    `Tools (shell/host; and more): ${GENERIC_TOOL_LIST}. Git.`,
    "",
    "You CAN run bun/git/bash via `run_terminal_command`. Do NOT wait on MCP. Do NOT request MCP for shell. " +
      "`mcpInheritance: none` means no MCP — use shell/files instead.",
    "",
    "`job: web` and messy test → LLM repo (web_search/web_fetch).",
    "",
  ].join("\n");
}

it("toClaudeShellBody: maps generic host shell names to Claude Bash only", () => {
  const generic = genericManagedBody();
  const claude = toClaudeShellBody(generic);
  expect(claude).toContain(CLAUDE_TOOL_LIST);
  expect(claude).not.toContain(GENERIC_TOOL_LIST);
  expect(claude).toMatch(/via `Bash`/);
  expect(claude).not.toMatch(/run_terminal_command/);
  expect(claude).toMatch(/WebSearch\/WebFetch/);
  expect(generic).toMatch(/run_terminal_command/);
  expect(generic).not.toMatch(/\bBash\b/);
});

it("emitAgentShellTools: rewrites only .claude/agents/scout.md body; leaves other agents", () => {
  const ws = tempDir("emit-shell-");
  const ssotDir = path.join(ws, "agents/subagents");
  fs.mkdirSync(ssotDir, { recursive: true });
  const body = genericManagedBody();
  fs.writeFileSync(path.join(ssotDir, "scout.md"), `---\nname: scout\nclaudecode:\n  tools: [Bash]\n---\n${body}`);
  fs.writeFileSync(
    path.join(ssotDir, "implementer.md"),
    "---\nname: implementer\n---\nNever run for simple tool usage.\n",
  );
  fs.mkdirSync(path.join(ws, ".claude/agents"), { recursive: true });
  fs.writeFileSync(
    path.join(ws, ".claude/agents/scout.md"),
    `---\nname: scout\nmodel: haiku\ntools:\n  - Bash\n---\n${body}`,
  );
  fs.writeFileSync(
    path.join(ws, ".claude/agents/implementer.md"),
    "---\nname: implementer\n---\nNever run for simple tool usage.\n",
  );
  const r = emitAgentShellTools({ check: false, workspaceRoot: ws });
  expect(r.ok).toBe(true);
  const repo = fs.readFileSync(path.join(ws, ".claude/agents/scout.md"), "utf8");
  expect(mdBody(repo)).toBe(toClaudeShellBody(body));
  expect(mdBody(repo)).toMatch(/\bBash\b/);
  expect(mdBody(repo)).not.toMatch(/run_terminal_command/);
  expect(fs.readFileSync(path.join(ws, ".claude/agents/implementer.md"), "utf8")).toBe(
    "---\nname: implementer\n---\nNever run for simple tool usage.\n",
  );
  expect(emitAgentShellTools({ check: true, workspaceRoot: ws }).ok).toBe(true);
});

it("emitAgentShellTools: check fails when Claude repo still names run_terminal_command", () => {
  const ws = tempDir("emit-shell-drift-");
  const ssotDir = path.join(ws, "agents/subagents");
  fs.mkdirSync(ssotDir, { recursive: true });
  const body = genericManagedBody();
  fs.writeFileSync(path.join(ssotDir, "scout.md"), `---\nname: scout\n---\n${body}`);
  fs.mkdirSync(path.join(ws, ".claude/agents"), { recursive: true });
  fs.writeFileSync(path.join(ws, ".claude/agents/scout.md"), `---\nname: scout\n---\n${body}`);
  const checked = emitAgentShellTools({ check: true, workspaceRoot: ws });
  expect(checked.ok).toBe(false);
  expect(String(checked.error)).toMatch(/drift/);
});

it("repo SSOT + emit: repo SSOT body is isolation facts; not Bash as host shell", () => {
  const raw = fs.readFileSync(path.join(repoRoot, "agents/subagents/scout.md"), "utf8");
  const body = mdBody(raw);
  expect(body).toMatch(/isolation facts/);
  expect(body).not.toMatch(/\bBash\b/);
  expect(raw).toMatch(/mcpInheritance:\s*none/);
});

it("repo SSOT + emit: orchestrator SSOT body does not name Bash as host shell", () => {
  const body = mdBody(fs.readFileSync(path.join(repoRoot, "agents/subagents/orchestrator.md"), "utf8"));
  expect(body).not.toMatch(/\bBash\b/);
});

it("repo SSOT + emit: non-Claude repo emit uses run_terminal_command; Claude uses Bash", () => {
  const grok = mdBody(fs.readFileSync(path.join(repoRoot, ".grok/agents/scout.md"), "utf8"));
  const agents = mdBody(fs.readFileSync(path.join(repoRoot, ".agents/agents/scout.md"), "utf8"));
  const claude = mdBody(fs.readFileSync(path.join(repoRoot, ".claude/agents/scout.md"), "utf8"));
  const codex = fs.readFileSync(path.join(repoRoot, ".codex/agents/scout.toml"), "utf8");
  const ssot = mdBody(fs.readFileSync(path.join(repoRoot, "agents/subagents/scout.md"), "utf8"));
  for (const body of [grok, agents]) {
    expect(body).toMatch(/isolation facts/);
    expect(body).not.toMatch(/\bBash\b/);
  }
  expect(codex).toMatch(/isolation facts|run_terminal_command/);
  expect(claude).toBe(toClaudeShellBody(ssot));
  expect(grok).toBe(ssot);
});

it("sourceRoot: reads the scout source from sourceRoot and rewrites only the staged Claude scout", () => {
  const stock = tempDir("shell-stock-");
  const out = tempDir("shell-out-");
  fs.mkdirSync(path.join(stock, "agents/subagents"), { recursive: true });
  fs.writeFileSync(path.join(stock, "agents/subagents/scout.md"), `---\nname: scout\n---\n${genericManagedBody()}`);
  fs.mkdirSync(path.join(out, ".claude/agents"), { recursive: true });
  fs.writeFileSync(path.join(out, ".claude/agents/scout.md"), "---\nname: scout\n---\nold\n");
  expect(emitAgentShellTools({ sourceRoot: stock, workspaceRoot: out }).ok).toBe(true);
  expect(emitAgentShellTools({ check: true, sourceRoot: stock, workspaceRoot: out }).ok).toBe(true);
  expect(fs.readFileSync(path.join(out, ".claude/agents/scout.md"), "utf8")).toContain(CLAUDE_TOOL_LIST);
  expect(fs.readdirSync(stock)).toStrictEqual(["agents"]);
});

const GOOD = "---\nname: scout\n---\nbody\n";

/** A workspace whose scout files hold the given text; null leaves the file out. */
function workspace(ssot: string | null, claude: string | null): string {
  const ws = tempDir("emit-shell-fail-");
  if (ssot !== null) {
    fs.mkdirSync(path.join(ws, "agents/subagents"), { recursive: true });
    fs.writeFileSync(path.join(ws, "agents/subagents/scout.md"), ssot);
  }
  if (claude !== null) {
    fs.mkdirSync(path.join(ws, ".claude/agents"), { recursive: true });
    fs.writeFileSync(path.join(ws, ".claude/agents/scout.md"), claude);
  }
  return ws;
}

it("emitAgentShellTools failures: names the file that is missing", () => {
  expect(emitAgentShellTools({ workspaceRoot: workspace(null, GOOD) })).toMatchObject({
    error: "missing agents/subagents/scout.md",
    ok: false,
  });
  expect(emitAgentShellTools({ check: true, workspaceRoot: workspace(GOOD, null) })).toStrictEqual({
    check: true,
    error: "missing .claude/agents/scout.md",
    ok: false,
  });
});

it("emitAgentShellTools failures: names the side whose frontmatter is broken", () => {
  expect(emitAgentShellTools({ workspaceRoot: workspace("no fm", GOOD) })).toMatchObject({
    error: "ssot: missing frontmatter",
    ok: false,
  });
  expect(emitAgentShellTools({ workspaceRoot: workspace(GOOD, "---\nname: scout\n") })).toMatchObject({
    error: "claude repo: missing frontmatter close",
    ok: false,
  });
});

it(
  "emitAgentShellTools output and reads: throws when a scout path cannot be read " +
    "for a reason other than being absent",
  () => {
    const ws = workspace(null, GOOD);
    fs.mkdirSync(path.join(ws, "agents/subagents/scout.md"), { recursive: true });
    expect(() => emitAgentShellTools({ workspaceRoot: ws })).toThrow("EISDIR");
  },
);

it(
  "emitAgentShellTools output and reads: writes a body that has no trailing newline with one, " +
    "and an empty body as it is",
  () => {
    const ws = workspace("---\nname: scout\n---\nrun_terminal_command", GOOD);
    expect(emitAgentShellTools({ workspaceRoot: ws }).ok).toBe(true);
    expect(fs.readFileSync(path.join(ws, ".claude/agents/scout.md"), "utf8")).toBe("---\nname: scout\n---\nBash\n");
    const empty = workspace("---\nname: scout\n---\n", GOOD);
    emitAgentShellTools({ workspaceRoot: empty });
    expect(fs.readFileSync(path.join(empty, ".claude/agents/scout.md"), "utf8")).toBe("---\nname: scout\n---\n");
  },
);

it("emitAgentShellTools output and reads: reads frontmatter from a missing value as none", () => {
  expect(splitFrontmatter(undefined)).toStrictEqual({ error: "missing frontmatter", ok: false });
});

it("emitAgentShellTools defaults: works on the current directory when given no options", () => {
  const ws = workspace("---\nname: scout\n---\nrun_terminal_command\n", "---\nname: scout\n---\nold\n");
  vi.spyOn(process, "cwd").mockReturnValue(ws);
  expect(emitAgentShellTools()).toStrictEqual({ check: false, ok: true });
  expect(fs.readFileSync(path.join(ws, ".claude/agents/scout.md"), "utf8")).toBe("---\nname: scout\n---\nBash\n");
});
