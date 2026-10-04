/**
 * The published package, end to end: launch it the way users do (npx, bunx, pnpm dlx,
 * yarn dlx) from a real registry into real consumer repos, then use what it installed.
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { beforeAll, describe, expect, inject, it } from "vitest";
import { GRUNT_PACKAGE } from "./registry";
import { BROKEN_RUNTIME, PM_CASES, type Run, Sandbox, tail } from "./sandbox";

const version = inject("version");
const oldVersion = inject("oldVersion");

function expectClean(sb: Sandbox, r: Run) {
  expect(r.out, tail(r.out)).not.toMatch(BROKEN_RUNTIME);
  sb.expectOk(r);
}

async function installedVersion(sb: Sandbox) {
  return sb.expectOk(await sb.grunt("version")).stdout.trim();
}

type HookCall = { file: string; event: string; matcher?: string; command: string };

/** Every command hook the consumer's agent hosts would run. */
function hookCalls(sb: Sandbox): HookCall[] {
  const files = [".claude/settings.json", ".codex/hooks.json", ".agents/hooks.json"];
  const grokDir = path.join(sb.repo, ".grok", "hooks");
  for (const f of fs.readdirSync(grokDir)) if (f.endsWith(".json") && f !== "package.json") files.push(`.grok/hooks/${f}`);
  const calls: HookCall[] = [];
  for (const file of files) {
    const hooks = sb.json(file).hooks ?? {};
    for (const [event, groups] of Object.entries(hooks)) {
      if (!Array.isArray(groups)) continue;
      for (const g of groups as { matcher?: string; hooks?: { type: string; command: string }[] }[]) {
        for (const h of g.hooks ?? []) if (h.type === "command") calls.push({ file, event, matcher: g.matcher, command: h.command });
      }
    }
  }
  return calls;
}

const TOOL_CALLS = [
  { tool_name: "Read", tool_input: { file_path: "src/index.ts" } },
  { tool_name: "Bash", tool_input: { command: "git status", description: "status" } },
  { tool_name: "Agent", tool_input: { description: "look", prompt: "List the src folder.", subagent_type: "grunt" } },
];

function hookPayloads(sb: Sandbox, call: HookCall) {
  const base = { session_id: "e2e-session", cwd: sb.repo, transcript_path: path.join(sb.root, "transcript.jsonl"), hook_event_name: call.event };
  if (call.event === "PreToolUse" || call.event === "PostToolUse") {
    const re = new RegExp(`^(?:${call.matcher || ".*"})$`);
    return TOOL_CALLS.filter((t) => re.test(t.tool_name)).map((t) => ({
      ...base,
      ...t,
      tool_input: t.tool_name === "Read" ? { file_path: path.join(sb.repo, "src/index.ts") } : t.tool_input,
      ...(call.event === "PostToolUse" ? { tool_response: { success: true } } : {}),
    }));
  }
  if (call.event === "UserPromptSubmit") return [{ ...base, prompt: "Summarize src/index.ts." }];
  if (call.event === "SessionStart") return [{ ...base, source: "startup" }];
  return [{ ...base, stop_hook_active: false }];
}

describe.each(PM_CASES)("$id", (pmCase) => {
  describe("fresh repo", () => {
    let sb: Sandbox;

    beforeAll(async () => {
      sb = new Sandbox(`fresh-${pmCase.id}`, pmCase);
      await sb.scaffold();
      expectClean(sb, await sb.launch(GRUNT_PACKAGE, "init"));
    });

    it("installs this exact build as a devDependency", async () => {
      expect(await installedVersion(sb)).toBe(version);
      expect(JSON.stringify(sb.json("package.json").devDependencies)).toContain(version);
    });

    it("writes the consumer tree and applies globals into HOME", () => {
      for (const rel of ["AGENTS.md", "CLAUDE.md", ".claude/settings.json", ".mcp.json", ".rulesync", "scripts/folder-map.mjs"]) {
        expect(sb.exists(rel), rel).toBe(true);
      }
      expect(fs.existsSync(path.join(sb.home, ".grok", "config.toml"))).toBe(true);
      const scripts = sb.json("package.json").scripts;
      expect(scripts["grunt:rulesync:generate"]).toBeTruthy();
      expect(scripts["grunt:rulesync:check"]).toBeTruthy();
    });

    // Hook entry files run on import; the hook test below executes them instead.
    it("every shipped script module loads in the consumer", async () => {
      const files = fs.readdirSync(path.join(sb.repo, "scripts")).filter((f) => f.endsWith(".mjs")).map((f) => `scripts/${f}`);
      expect(files.length).toBeGreaterThan(20);
      // A file, not `-e`: cmd.exe mangles inline code on its way through yarn's .cmd shim.
      const urls = files.map((f) => pathToFileURL(path.join(sb.repo, f)).href);
      const loader = path.join(sb.root, "load-scripts.mjs");
      fs.writeFileSync(loader, `for (const u of ${JSON.stringify(urls)}) await import(u);\n`);
      expectClean(sb, await sb.node(loader));
    });

    it("every agent-host hook runs without crashing", async () => {
      const calls = hookCalls(sb);
      expect(calls.length).toBeGreaterThan(5);
      for (const call of calls) {
        for (const payload of hookPayloads(sb, call)) {
          const r = await sb.run("bash", ["-c", call.command], {
            input: JSON.stringify(payload),
            env: { CLAUDE_PROJECT_DIR: sb.repo, ...(call.file.startsWith(".grok") ? { GROK_WORKSPACE_ROOT: sb.repo } : {}) },
          });
          const label = `${call.file} ${call.event} ${(payload as { tool_name?: string }).tool_name ?? ""}: ${call.command}\n${tail(r.out)}`;
          expect(r.out, label).not.toMatch(BROKEN_RUNTIME);
          expect([0, 2], label).toContain(r.status);
        }
      }
    });

    it("session start hook injects the folder map", async () => {
      const r = await sb.run("bash", ["-c", 'node "$CLAUDE_PROJECT_DIR/scripts/session-map.mjs"'], {
        input: JSON.stringify({ hook_event_name: "SessionStart", session_id: "e2e", cwd: sb.repo, source: "startup" }),
        env: { CLAUDE_PROJECT_DIR: sb.repo },
      });
      expectClean(sb, r);
      expect(r.stdout).toContain("src/");
    });

    it("installed CLI subcommands work", async () => {
      expect(await installedVersion(sb)).toBe(version);
      expect(sb.expectOk(await sb.grunt("help")).stdout).toContain("Usage: grunt");
      expect(sb.expectOk(await sb.grunt("map")).stdout).toContain("src/");
      for (const cmd of ["check", "sync-globals", "purge-mcps", "generate"]) {
        expectClean(sb, await sb.grunt(cmd, "--pm", pmCase.pm));
      }
    });

    it("package scripts run through the package manager", async () => {
      expectClean(sb, await sb.pmRun("grunt:rulesync:check"));
      expectClean(sb, await sb.pmRun("grunt:sync:globals"));
    });

    it("re-init is idempotent", async () => {
      await sb.commit("first init");
      expectClean(sb, await sb.launch(GRUNT_PACKAGE, "init"));
      expect((await sb.git("status", "--porcelain")).stdout).toBe("");
    });
  });

  it("upgrade self-updates an older install to latest", async () => {
    const sb = new Sandbox(`upgrade-${pmCase.id}`, pmCase);
    await sb.scaffold();
    expectClean(sb, await sb.launch(`${GRUNT_PACKAGE}@${oldVersion}`, "init"));
    expect(await installedVersion(sb)).toBe(oldVersion);
    expectClean(sb, await sb.grunt("upgrade", "--pm", pmCase.pm));
    expect(await installedVersion(sb)).toBe(version);
    expect(JSON.stringify(sb.json("package.json").devDependencies)).toContain(version);
  });
});

describe("existing repo content survives init", () => {
  it("keeps user scripts, deps, guarded markdown, and Claude settings", async () => {
    const sb = new Sandbox("existing", PM_CASES[0]);
    await sb.scaffold({ scripts: { build: "tsc -p ." }, devDependencies: { typescript: "^5.9.3" } });
    sb.write("AGENTS.md", "# Team rules\n\nAlways run the linter.\n");
    sb.write(".claude/settings.json", `${JSON.stringify({ permissions: { allow: ["Bash(make test)"] } }, null, 2)}\n`);
    await sb.commit("existing content");
    expectClean(sb, await sb.launch(GRUNT_PACKAGE, "init"));

    const pkg = sb.json("package.json");
    expect(pkg.scripts.build).toBe("tsc -p .");
    expect(pkg.devDependencies.typescript).toBe("^5.9.3");
    expect(sb.read("AGENTS.md")).toContain("Always run the linter.");
    expect(sb.json(".claude/settings.json").permissions.allow).toContain("Bash(make test)");
  });
});
