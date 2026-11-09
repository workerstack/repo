import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { HOSTS, type Host, type SkillPack } from "../config.ts";
import type { Output, SyncContext } from "./outputs.ts";
import { runSync } from "../sync.ts";
import { renderTrees } from "./trees.ts";
import { BUN, linkText } from "../../dev/test-paths.ts";

const SELF_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const STOCK_SKILL = "../../node_modules/@workerstack/repo/agents/skills";
// A render copies and merges on a disk stage, and one test renders up to three times.
const RENDER_TIMEOUT = 60_000;

const temps: string[] = [];

afterEach(() => {
  for (const dir of temps.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "workerstack-trees-"));
  temps.push(dir);
  return dir;
}

/** The stage dirs a render left under `root`. */
function stagesIn(root: string): string[] {
  const dir = path.join(root, ".repo", "tmp");
  return fs.existsSync(dir) ? fs.readdirSync(dir).filter((name) => name.startsWith("stage-")) : [];
}

function write(root: string, rel: string, text: string): void {
  const file = path.join(root, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

/** A consumer: a config, a package.json and `node_modules/@workerstack/repo` linked to this repo's root. */
function consumer(files: Record<string, string> = {}): string {
  const root = tempDir();
  write(root, "workerstack.config.ts", "export default {}\n");
  write(root, "package.json", JSON.stringify({ name: "fixture", scripts: { build: "tsc" } }));
  fs.mkdirSync(path.join(root, "node_modules", "@workerstack"), { recursive: true });
  fs.symlinkSync(SELF_ROOT, path.join(root, "node_modules", "@workerstack", "repo"), "dir");
  for (const [rel, text] of Object.entries(files)) write(root, rel, text);
  return root;
}

function context(root: string, hosts: readonly Host[], skills: readonly SkillPack[] = []): SyncContext {
  return {
    root,
    config: { packs: ["agents"], agents: { hosts, skills } },
    workspace: { root, manifest: { name: "fixture" }, packages: [] },
    read: (rel) => {
      try {
        return fs.readFileSync(path.join(root, rel), "utf8");
      } catch {
        return null;
      }
    },
  };
}

function render(root: string, hosts: readonly Host[], skills: readonly SkillPack[] = []): Output[] {
  const result = renderTrees(context(root, hosts, skills));
  if (!result.ok) throw new Error(result.error);
  return result.outputs;
}

function find(outputs: Output[], rel: string): Output | undefined {
  return outputs.find((output) => output.path === rel);
}

function text(outputs: Output[], rel: string): string {
  const output = find(outputs, rel);
  if (output?.kind !== "file") throw new Error(`${rel} is not a file output`);
  return output.content;
}

function linkTarget(outputs: Output[], rel: string): string | undefined {
  const output = find(outputs, rel);
  return output?.kind === "link" ? output.target : undefined;
}

function json(outputs: Output[], rel: string): Record<string, any> {
  return JSON.parse(text(outputs, rel)) as Record<string, any>;
}

const paths = (outputs: Output[]) => outputs.map((output) => output.path);

describe("renderTrees with every host", { timeout: RENDER_TIMEOUT }, () => {
  const root = consumer({
    ".vscode/tasks.json": JSON.stringify({
      version: "2.0.0",
      tasks: [{ label: "mine", type: "shell", command: "make all", dependsOn: ["x"] }],
    }),
  });
  const outputs = render(root, HOSTS);

  it("writes AGENTS.md, .mcp.json and every host tree, untracked", () => {
    const top = new Set(paths(outputs).map((rel) => (rel.includes("/") ? rel.slice(0, rel.indexOf("/")) : rel)));
    expect([...top].sort()).toEqual(
      [".agents", ".claude", ".codex", ".cursor", ".grok", ".mcp.json", ".vscode", "AGENTS.md"].sort(),
    );
    for (const output of outputs.filter((o) => o.path !== ".vscode/tasks.json")) expect(output.tracked).toBe(false);
  });

  it("generates the committed-shape files the generators and the emit steps own", () => {
    for (const rel of [
      ".claude/settings.json",
      ".claude/agents/scout.md",
      ".codex/config.toml",
      ".codex/hooks.json",
      ".agents/hooks.json",
      ".agents/agents/scout.md",
      ".cursor/hooks.json",
      ".grok/config.toml",
      ".grok/agents/scout.md",
    ]) {
      expect(find(outputs, rel)?.kind, rel).toBe("file");
    }
    expect(json(outputs, ".mcp.json")).toHaveProperty("mcpServers");
    expect(text(outputs, ".claude/settings.json")).toContain("repo");
  });

  it("copies the static grok files and never a .grok/hooks script", () => {
    expect(find(outputs, ".grok/roles/scout.toml")?.kind).toBe("file");
    expect(find(outputs, ".grok/hooks/rulesync.json")?.kind).toBe("file");
    expect(find(outputs, ".grok/hooks/orchestrate-parent.json")?.kind).toBe("file");
    expect(paths(outputs).filter((rel) => rel.startsWith(".grok/hooks/") && /\.(ts|tsx)$/.test(rel))).toEqual([]);
    expect(find(outputs, ".grok/hooks/package.json")).toBeUndefined();
  });

  it("keeps a consumer's own task in the tracked .vscode/tasks.json", () => {
    const tasks = json(outputs, ".vscode/tasks.json");
    expect(find(outputs, ".vscode/tasks.json")?.tracked).toBe(true);
    expect(tasks.tasks.map((task: { label: string }) => task.label)).toEqual(["build", "mine"]);
  });

  it("removes the stage dir", () => {
    expect(stagesIn(root)).toEqual([]);
  });
});

describe("renderTrees by host", { timeout: RENDER_TIMEOUT }, () => {
  it("claude alone writes AGENTS.md, .mcp.json and .claude, with skills linked straight to stock", () => {
    const outputs = render(consumer(), ["claude"]);
    const rest = paths(outputs).filter((rel) => rel !== ".vscode/tasks.json");
    expect(rest.filter((rel) => !rel.startsWith(".claude/")).sort()).toEqual(["AGENTS.md", ".mcp.json"].sort());
    expect(linkTarget(outputs, ".claude/skills/ask")).toBe(`${STOCK_SKILL}/ask`);
    expect(find(outputs, ".claude/skills/ask")?.tracked).toBe(false);
    expect(find(outputs, ".claude/skills/listen")).toBeUndefined();
  });

  it("codex alone links .agents/skills and writes no .agents/agents", () => {
    const outputs = render(consumer(), ["codex"]);
    expect(linkTarget(outputs, ".agents/skills/ask")).toBe(`${STOCK_SKILL}/ask`);
    expect(paths(outputs).filter((rel) => rel.startsWith(".agents/") && !rel.startsWith(".agents/skills/"))).toEqual([]);
    expect(paths(outputs).some((rel) => rel.startsWith(".claude/"))).toBe(false);
    expect(find(outputs, ".mcp.json")).toBeUndefined();
    expect(find(outputs, ".codex/config.toml")?.kind).toBe("file");
    expect(find(outputs, ".agents/mcp_config.json")).toBeUndefined();
  });

  it("antigravity alone writes .agents, and claude links through it when both are on", () => {
    const agy = render(consumer(), ["antigravity"]);
    expect(find(agy, ".agents/agents/scout.md")?.kind).toBe("file");
    expect(linkTarget(agy, ".agents/skills/ask")).toBe(`${STOCK_SKILL}/ask`);
    const both = render(consumer(), ["claude", "antigravity"]);
    expect(linkTarget(both, ".claude/skills/ask")).toBe("../../.agents/skills/ask");
  });

  it("grok and cursor alone write only their dirs and AGENTS.md", () => {
    const outputs = render(consumer(), ["grok", "cursor"]);
    const top = new Set(paths(outputs).map((rel) => rel.split("/")[0]));
    expect([...top].sort()).toEqual([".cursor", ".grok", ".vscode", "AGENTS.md"].sort());
  });

  it("no hosts writes nothing and runs nothing", () => {
    const root = consumer();
    expect(render(root, [])).toEqual([]);
    expect(fs.existsSync(path.join(root, ".repo"))).toBe(false);
  });
});

describe("renderTrees skills", { timeout: RENDER_TIMEOUT }, () => {
  it("leaves out an optional pack unless agents.skills lists it", () => {
    const off = render(consumer(), ["claude", "codex"]);
    expect(find(off, ".agents/skills/listen")).toBeUndefined();
    expect(find(off, ".claude/skills/listen")).toBeUndefined();
    const on = render(consumer(), ["claude", "codex"], ["listen"]);
    expect(linkTarget(on, ".agents/skills/listen")).toBe(`${STOCK_SKILL}/listen`);
    expect(linkTarget(on, ".claude/skills/listen")).toBe("../../.agents/skills/listen");
  });

  it("lets a .repo/skills skill win over the stock one and add its own", () => {
    const root = consumer({
      ".repo/skills/ask/SKILL.md": "---\nname: ask\ndescription: mine\n---\n",
      ".repo/skills/deploy/SKILL.md": "---\nname: deploy\ndescription: ship\n---\n",
    });
    const claude = render(root, ["claude"]);
    expect(linkTarget(claude, ".claude/skills/ask")).toBe("../../.repo/skills/ask");
    expect(linkTarget(claude, ".claude/skills/deploy")).toBe("../../.repo/skills/deploy");
    const codex = render(root, ["codex"]);
    expect(linkTarget(codex, ".agents/skills/ask")).toBe("../../.repo/skills/ask");
    expect(linkTarget(codex, ".agents/skills/bro")).toBe(`${STOCK_SKILL}/bro`);
  });
});

describe("renderTrees overlay", { timeout: RENDER_TIMEOUT }, () => {
  it("puts a .repo/rules rule in AGENTS.md", () => {
    const root = consumer({
      ".repo/rules/house.md": '---\nroot: false\ntargets: ["*"]\ndescription: house\nglobs: ["**/*"]\n---\nAlways greet the cat.\n',
    });
    expect(text(render(root, ["claude"]), "AGENTS.md")).toContain("Always greet the cat.");
  });

  it("keeps the .repo/rules rule in AGENTS.md with every host on", () => {
    const root = consumer({
      ".repo/rules/house.md": '---\nroot: false\ntargets: ["*"]\ndescription: house\nglobs: ["**/*"]\n---\nAlways greet the cat.\n',
    });
    expect(text(render(root, HOSTS), "AGENTS.md")).toContain("Always greet the cat.");
  });

  describe("a migrated-shape rule with its own targets and globs", () => {
    const rule = '---\nroot: false\ntargets:\n  - agentsmd\nglobs: ["src/**"]\n---\nTEAM RULE TEXT\n';
    const reach = (hosts: readonly Host[]) => {
      const outputs = render(consumer({ ".repo/rules/team.md": rule }), hosts);
      return outputs.filter((o) => o.kind === "file" && o.content.includes("TEAM RULE TEXT")).map((o) => o.path);
    };

    it("reaches AGENTS.md with every host on, with codex only and with claude only", () => {
      for (const hosts of [HOSTS, ["codex"], ["claude"]] as Host[][]) expect(reach(hosts), hosts.join()).toContain("AGENTS.md");
    });
  });

  it("merges .repo/settings/claude.json into .claude/settings.json", () => {
    const root = consumer({
      ".repo/settings/claude.json": JSON.stringify({
        env: { MINE: "1" },
        enableAllProjectMcpServers: true,
        permissions: { allow: ["Bash(ls:*)"], deny: ["Agent(Explore)", "Read(./secret)"] },
      }),
    });
    const settings = json(render(root, ["claude"]), ".claude/settings.json");
    expect(settings.env).toEqual({ MINE: "1" });
    expect(settings.permissions.allow).toContain("Bash(ls:*)");
    expect(settings.enableAllProjectMcpServers).toBe(true);
    expect(settings.permissions.deny.filter((rule: string) => rule === "Agent(Explore)")).toHaveLength(1);
    expect(settings.permissions.deny).toContain("Read(./secret)");
    expect(Object.keys(settings.hooks).length).toBeGreaterThan(0);
  });

  it("appends .repo hooks after the generated ones and never repeats a stock hook", () => {
    const plain = json(render(consumer(), ["claude"]), ".claude/settings.json");
    const stockGroup = plain.hooks.PreToolUse[0];
    const mine = { matcher: "Write", hooks: [{ type: "command", command: "make post-write", timeout: 5 }] };
    const root = consumer({ ".repo/settings/claude.json": JSON.stringify({ hooks: { PreToolUse: [stockGroup], PostToolUse: [mine] } }) });
    const settings = json(render(root, ["claude"]), ".claude/settings.json");
    expect(settings.hooks.PreToolUse).toEqual(plain.hooks.PreToolUse);
    expect(settings.hooks.PostToolUse).toEqual([...(plain.hooks.PostToolUse ?? []), mine]);
    expect(settings.hooks.PostToolUse.at(-1)).toEqual(mine);
  });

  it("reports an unreadable .repo/settings/claude.json", () => {
    const root = consumer({ ".repo/settings/claude.json": "{" });
    const result = renderTrees(context(root, ["claude"]));
    expect(result).toEqual({ ok: false, error: expect.stringContaining(".repo/settings/claude.json") });
    expect(stagesIn(root)).toEqual([]);
  });

  it("reports a .repo/settings/claude.json that is not an object", () => {
    const root = consumer({ ".repo/settings/claude.json": "[]" });
    expect(renderTrees(context(root, ["claude"]))).toEqual({ ok: false, error: expect.stringContaining("must be a JSON object") });
  });

  it("deep-merges .repo/mcp.json over the generated .mcp.json", () => {
    const server = { command: "npx", args: ["-y", "mine"] };
    const root = consumer({ ".repo/mcp.json": JSON.stringify({ mcpServers: { mine: server } }) });
    const mcp = json(render(root, ["claude"]), ".mcp.json");
    expect(mcp.mcpServers.mine).toEqual(server);
    expect(json(render(consumer(), ["claude"]), ".mcp.json").mcpServers.mine).toBeUndefined();
  });

  it("reports an unreadable .repo/mcp.json, and one that is not an object", () => {
    expect(renderTrees(context(consumer({ ".repo/mcp.json": "{" }), ["claude"]))).toEqual({
      ok: false,
      error: expect.stringContaining(".repo/mcp.json"),
    });
    expect(renderTrees(context(consumer({ ".repo/mcp.json": "[]" }), ["claude"]))).toEqual({
      ok: false,
      error: ".repo/mcp.json: must be a JSON object",
    });
  });

  it("ignores .repo/mcp.json when claude is off", () => {
    expect(renderTrees(context(consumer({ ".repo/mcp.json": "{" }), ["codex"])).ok).toBe(true);
  });

  it("reports an emit step that rejects the merged mcp policy", () => {
    const root = consumer({ ".repo/mcp-policy.jsonc": '{ "allow": 5 }' });
    expect(renderTrees(context(root, ["claude"]))).toEqual({ ok: false, error: "mcp policy: allow must be an array" });
    expect(stagesIn(root)).toEqual([]);
  });

  it("ignores .repo/settings/claude.json when claude is off", () => {
    const root = consumer({ ".repo/settings/claude.json": "{" });
    expect(renderTrees(context(root, ["codex"])).ok).toBe(true);
  });

  it("keeps a consumer scripts/ hook and a .repo/permissions.json deny in the hook files", () => {
    const root = consumer({
      "scripts/daily-pull-check.mjs": "// pull\n",
      ".repo/permissions.json": JSON.stringify({ deny: ["Edit(./vendor/**)"] }),
    });
    const outputs = render(root, ["claude", "codex"]);
    expect(text(outputs, ".claude/settings.json")).toContain("daily-pull-check.mjs");
    expect(text(outputs, ".claude/settings.json")).toContain("Edit(./vendor/**)");
    expect(text(outputs, ".codex/hooks.json")).toContain("daily-pull-check.mjs");
  });

  it("merges a .repo/mcp-policy.jsonc over the stock policy", () => {
    const root = consumer({ ".repo/mcp-policy.jsonc": '{ "allow": ["mine"], "servers": { "mine": { "command": "x" } } }' });
    expect(json(render(root, ["claude"]), ".mcp.json").mcpServers).toHaveProperty("mine");
  });
});

describe("renderTrees tasks", { timeout: RENDER_TIMEOUT }, () => {
  it("fails on a tasks.json it cannot parse", () => {
    const root = consumer({ ".vscode/tasks.json": "{" });
    const result = renderTrees(context(root, ["claude"]));
    expect(result).toEqual({ ok: false, error: expect.stringContaining(".vscode/tasks.json") });
    expect(stagesIn(root)).toEqual([]);
  });
});

describe("renderTrees sources", { timeout: RENDER_TIMEOUT }, () => {
  it("names a .repo rule without frontmatter and removes the stage", () => {
    const root = consumer({ ".repo/rules/nofm.md": "no frontmatter here\n" });
    expect(renderTrees(context(root, ["codex"]))).toEqual({
      ok: false,
      error: ".repo/rules/nofm.md: missing frontmatter (start the file with a --- block)",
    });
    expect(stagesIn(root)).toEqual([]);
  });

  it("reports a missing stock package", () => {
    const bare = tempDir();
    write(bare, "workerstack.config.ts", "export default {}\n");
    expect(renderTrees(context(bare, ["claude"]))).toEqual({ ok: false, error: expect.stringContaining("bun install") });
  });
});

describe("renderTrees in this repo", { timeout: RENDER_TIMEOUT }, () => {
  it("keeps every output tracked and links skills inside the repo", () => {
    const result = renderTrees({
      ...context(SELF_ROOT, HOSTS, ["google-workspace", "listen", "speak", "clasp"]),
      workspace: { root: SELF_ROOT, manifest: { name: "@workerstack/repo" }, packages: [] },
    });
    if (!result.ok) throw new Error(result.error);
    expect(result.outputs.every((output) => output.tracked)).toBe(true);
    expect(linkTarget(result.outputs, ".claude/skills/ask")).toBe("../../agents/skills/ask");
    expect(linkTarget(result.outputs, ".agents/skills/ask")).toBe("../../agents/skills/ask");
  });

  it("renders the same files while other processes render the same root", async () => {
    const trees = pathToFileURL(path.join(SELF_ROOT, "cli", "sync", "trees.ts")).href;
    const script = `
      const { renderTrees } = await import(${JSON.stringify(trees)});
      const seen = new Set();
      for (let i = 0; i < 6; i++) {
        const result = renderTrees({
          root: ${JSON.stringify(SELF_ROOT)},
          config: { packs: ["agents"], agents: { hosts: ${JSON.stringify(HOSTS)}, skills: [] } },
          workspace: { root: ${JSON.stringify(SELF_ROOT)}, manifest: { name: "@workerstack/repo" }, packages: [] },
          read: () => null,
        });
        seen.add(result.ok ? result.outputs.map((output) => output.path).join(",") : result.error);
      }
      process.stdout.write(JSON.stringify([...seen]));`;
    const child = () =>
      new Promise<string>((resolve, reject) => {
        const proc = spawn(BUN, ["-e", script], { cwd: SELF_ROOT, stdio: ["ignore", "pipe", "inherit"] });
        let out = "";
        proc.stdout.on("data", (chunk) => (out += String(chunk)));
        proc.on("error", reject);
        proc.on("close", () => resolve(out));
      });
    const results = await Promise.all([child(), child(), child(), child()]);
    expect(new Set(results).size).toBe(1);
    expect(JSON.parse(results[0] as string)).toHaveLength(1);
  });

  it("regenerates the committed trees byte for byte", async () => {
    const out: string[] = [];
    const code = await runSync(["--check"], { cwd: SELF_ROOT, stdout: (s) => out.push(s), stderr: (s) => out.push(s) });
    expect(out.join("")).toBe("repo sync: up to date\n");
    expect(code).toBe(0);
  });
});

describe("repo sync with trees", { timeout: RENDER_TIMEOUT }, () => {
  async function sync(root: string, ...args: string[]) {
    const out: string[] = [];
    const err: string[] = [];
    const code = await runSync(args, { cwd: root, stdout: (s) => out.push(s), stderr: (s) => err.push(s) });
    return { code, stdout: out.join(""), stderr: err.join("") };
  }

  it("replaces a dangling skill link left by a removed node_modules instead of following it", async () => {
    const root = consumer();
    write(root, "workerstack.config.ts", 'export default { agents: { hosts: ["claude"] } }\n');
    fs.mkdirSync(path.join(root, ".claude", "skills"), { recursive: true });
    fs.symlinkSync("../../gone/ask", path.join(root, ".claude", "skills", "ask"), "dir");

    expect((await sync(root)).code).toBe(0);
    const link = path.join(root, ".claude", "skills", "ask");
    expect(linkText(link)).toBe(`${STOCK_SKILL}/ask`);
    expect(fs.existsSync(path.join(link, "SKILL.md"))).toBe(true);
    expect(fs.existsSync(path.join(root, "gone"))).toBe(false);
    expect(await sync(root, "--check")).toEqual({ code: 0, stdout: "repo sync: up to date\n", stderr: "" });
  });

  it("reports a failed render and leaves no stage behind", async () => {
    const root = consumer({ ".repo/settings/claude.json": "{" });
    write(root, "workerstack.config.ts", 'export default { agents: { hosts: ["claude"] } }\n');
    const result = await sync(root);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain(".repo/settings/claude.json");
    expect(stagesIn(root)).toEqual([]);
    expect(fs.existsSync(path.join(root, "AGENTS.md"))).toBe(false);
  });

  it("fails on a .repo subagent with broken frontmatter, naming the file", async () => {
    const root = consumer({ ".repo/subagents/bad.md": "---\nname: [unclosed\n---\nbody\n" });
    write(root, "workerstack.config.ts", 'export default { agents: { hosts: ["claude"] } }\n');
    const result = await sync(root);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("sync: .repo/subagents/bad.md: invalid frontmatter: ");
  });
});
