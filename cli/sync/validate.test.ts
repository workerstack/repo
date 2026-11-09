import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { readGoldens, renderFixtureTrees } from "../../dev/capture-tree-goldens.ts";
import { loadConfig } from "../config.ts";
import { computeOutputs } from "../sync.ts";
import type { Output } from "./outputs.ts";
import { validateOutputs } from "./validate.ts";
import { readWorkspace } from "./workspace.ts";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SLOW = 60_000;

const tmpDirs: string[] = [];
afterEach(() => {
  for (const dir of tmpDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function tmpRoot(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "workerstack-validate-"));
  tmpDirs.push(dir);
  return dir;
}

const file = (p: string, content: string): Output => ({ kind: "file", path: p, content, tracked: true });
const link = (p: string, target: string): Output => ({ kind: "link", path: p, target, tracked: true });
const AGENT = "---\nname: scout\ndescription: Facts only.\n---\nBody\n";

describe("file formats", () => {
  it("accepts well-formed json, toml, markdown and text", () => {
    const root = tmpRoot();
    const outputs = [
      file(".vscode/tasks.json", "{}\n"),
      file("bunfig.toml", '[install]\nlinker = "hoisted"\n'),
      file("AGENTS.md", "# Plain markdown\n"),
      file("references/INDEX.md", "---\n---\nEmpty frontmatter\n"),
      file(".gitignore", "anything\n"),
      file(".claude/agents/scout.md", AGENT),
      file(".claude/agents/crlf.md", "---\r\nname: a\r\ndescription: b\r\n---\r\nBody\r\n"),
    ];
    expect(validateOutputs(root, outputs)).toEqual([]);
  });

  it("reports bad JSON with the parser's message", () => {
    const lines = validateOutputs(tmpRoot(), [file(".vscode/tasks.json", "{ nope")]);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^\.vscode\/tasks\.json: invalid JSON: /);
  });

  it("reports bad TOML with the parser's message", () => {
    const lines = validateOutputs(tmpRoot(), [file("bunfig.toml", "[install\nx = ")]);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^bunfig\.toml: invalid TOML: /);
  });

  it("reports bad YAML frontmatter", () => {
    const lines = validateOutputs(tmpRoot(), [file("AGENTS.md", "---\nname: [unclosed\n---\nBody\n")]);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^AGENTS\.md: invalid frontmatter: /);
  });

  it("reports frontmatter that is not closed", () => {
    expect(validateOutputs(tmpRoot(), [file("AGENTS.md", "---\nname: a\nBody\n")])).toEqual([
      "AGENTS.md: invalid frontmatter: no closing ---",
    ]);
  });

  it("reports frontmatter that is not a mapping", () => {
    expect(validateOutputs(tmpRoot(), [file("AGENTS.md", "---\n- a\n- b\n---\nBody\n")])).toEqual([
      "AGENTS.md: invalid frontmatter: must be a mapping",
    ]);
  });

  it("checks agent frontmatter against its schema", () => {
    const lines = validateOutputs(tmpRoot(), [
      file(".cursor/agents/a.md", "---\nname: a\n---\nBody\n"),
      file(".grok/agents/b.md", "No frontmatter at all\n"),
    ]);
    expect(lines).toEqual([
      ".cursor/agents/a.md: description: Invalid input: expected string, received undefined",
      ".grok/agents/b.md: name: Invalid input: expected string, received undefined",
      ".grok/agents/b.md: description: Invalid input: expected string, received undefined",
    ]);
  });

  it("reports a schema miss with its dotted path and zod's message", () => {
    const settings = JSON.stringify({ hooks: { PreToolUse: "x" } });
    expect(validateOutputs(tmpRoot(), [file(".claude/settings.json", settings)])).toEqual([
      ".claude/settings.json: hooks.PreToolUse: Invalid input: expected array, received string",
    ]);
  });

  it("reports a schema miss at the top level without a dotted path", () => {
    expect(validateOutputs(tmpRoot(), [file(".mcp.json", "[]")])).toEqual([
      ".mcp.json: Invalid input: expected object, received array",
    ]);
  });

  it("reports indexes in a dotted path", () => {
    const settings = JSON.stringify({ hooks: { Stop: [{ hooks: [{ command: 1 }] }] } });
    const lines = validateOutputs(tmpRoot(), [file(".claude/settings.json", settings)]);
    expect(lines).toContain(".claude/settings.json: hooks.Stop.0.hooks.0.type: Invalid input: expected string, received undefined");
  });

  it("accepts keys the host may add", () => {
    const hooks = { hooks: { Stop: [{ future: 1, hooks: [{ type: "prompt", prompt: "x", timeout: 5, extra: true }] }] }, other: 1 };
    const outputs = [
      file(".claude/settings.json", JSON.stringify({ ...hooks, permissions: { deny: ["x"], allow: [] } })),
      file(".codex/hooks.json", JSON.stringify(hooks)),
      file(".cursor/hooks.json", JSON.stringify({ version: 1, hooks: { stop: [{ type: "command", command: "x", matcher: "y", extra: 1 }] } })),
      file(".agents/hooks.json", JSON.stringify({ rulesync: { Stop: [{ command: "x" }, { matcher: "m", hooks: [{ type: "command" }] }] } })),
      file(".agents/mcp_config.json", JSON.stringify({ mcpServers: { a: { command: "x" } } })),
      file(".grok/hooks/rtk.json", JSON.stringify(hooks)),
    ];
    expect(validateOutputs(tmpRoot(), outputs)).toEqual([]);
  });

  it("accepts the empty hook files the generators emit", () => {
    const outputs = [file(".agents/hooks.json", "{}"), file(".grok/hooks/rulesync.json", '{"hooks":{}}'), file(".mcp.json", '{"mcpServers":{}}')];
    expect(validateOutputs(tmpRoot(), outputs)).toEqual([]);
  });

  it("refuses a file path with no registered format", () => {
    expect(validateOutputs(tmpRoot(), [file("docs/x.yaml", "a: 1\n")])).toEqual([
      "docs/x.yaml: no output format registered; add it to cli/sync/validate.ts",
    ]);
  });

  it("reports every problem, in output order", () => {
    const lines = validateOutputs(tmpRoot(), [file("b.yaml", ""), file(".vscode/tasks.json", "{"), file("a.yaml", "")]);
    expect(lines.map((line) => line.split(":")[0])).toEqual(["b.yaml", ".vscode/tasks.json", "a.yaml"]);
  });
});

describe("links", () => {
  it("accepts a link to a path on disk, relative or absolute", () => {
    const root = tmpRoot();
    fs.mkdirSync(path.join(root, "agents/skills/ask"), { recursive: true });
    const outputs = [link(".agents/skills/ask", "../../agents/skills/ask"), link(".agents/skills/abs", path.join(root, "agents/skills/ask"))];
    expect(validateOutputs(root, outputs)).toEqual([]);
  });

  it("reports a dangling link", () => {
    expect(validateOutputs(tmpRoot(), [link(".agents/skills/ask", "../../agents/skills/ask")])).toEqual([
      ".agents/skills/ask: link target ../../agents/skills/ask does not exist",
    ]);
  });

  it("reports a link that leaves the repo for a missing path", () => {
    const lines = validateOutputs(tmpRoot(), [link("a/b", "../../../no-such-dir-workerstack")]);
    expect(lines).toEqual(["a/b: link target ../../../no-such-dir-workerstack does not exist"]);
  });

  it("follows a link whose target is another planned link into an existing dir", () => {
    const root = tmpRoot();
    fs.mkdirSync(path.join(root, ".repo/skills/x"), { recursive: true });
    const outputs = [link(".claude/skills/x", "../../.agents/skills/x"), link(".agents/skills/x", "../../.repo/skills/x")];
    expect(validateOutputs(root, outputs)).toEqual([]);
    expect(validateOutputs(root, [...outputs].reverse())).toEqual([]);
  });

  it("reports a chain of planned links that ends in nothing", () => {
    const outputs = [link(".claude/skills/x", "../../.agents/skills/x"), link(".agents/skills/x", "../../.repo/skills/x")];
    expect(validateOutputs(tmpRoot(), outputs)).toEqual([
      ".claude/skills/x: link target ../../.agents/skills/x does not exist",
      ".agents/skills/x: link target ../../.repo/skills/x does not exist",
    ]);
  });

  it("reports planned links that point at each other", () => {
    const outputs = [link("a", "b"), link("b", "a")];
    expect(validateOutputs(tmpRoot(), outputs)).toEqual(["a: link target b does not exist", "b: link target a does not exist"]);
  });

  it("accepts a link into a planned dir that is not on disk yet", () => {
    const outputs = [link(".claude/skills/x", "../../.codex/agents"), file(".codex/agents/a.toml", 'name = "a"\n')];
    expect(validateOutputs(tmpRoot(), outputs)).toEqual([]);
  });

  it("checks files against the formats it is given", () => {
    const formats = [{ match: () => true, format: "text" as const }];
    expect(validateOutputs(tmpRoot(), [file("docs/x.yaml", "a: 1\n")], formats)).toEqual([]);
  });
});

describe("registered formats", () => {
  it("accepts every output of the golden consumer fixture", { timeout: SLOW }, async () => {
    const rendered = await renderFixtureTrees();
    expect([...rendered.keys()]).toEqual([...readGoldens().keys()]);
    const outputs = [...rendered].map(([rel, content]) => file(rel, content));
    expect(outputs.length).toBeGreaterThan(30);
    expect(validateOutputs(tmpRoot(), outputs)).toEqual([]);
  });

  it("accepts every output this repo plans", { timeout: SLOW }, async () => {
    const config = await loadConfig(REPO_ROOT);
    const workspace = readWorkspace(REPO_ROOT);
    if (!config.ok || !workspace.ok) throw new Error("this repo's config or workspace did not load");
    const planned = computeOutputs(REPO_ROOT, config.config, workspace.workspace);
    if (!planned.ok) throw new Error(planned.errors.join("\n"));
    expect(planned.outputs.length).toBeGreaterThan(100);
    expect(validateOutputs(REPO_ROOT, planned.outputs)).toEqual([]);
  });
});
