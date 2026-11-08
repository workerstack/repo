/**
 * The published package, end to end: launch it the way users do (bunx) from a real
 * registry into real consumer repos, then use what it installed.
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { beforeAll, describe, expect, inject, it } from "vitest";
import { isRecord, isStringList, isStringMap } from "./json";
import { PACKAGE_NAME } from "./registry";
import { BROKEN_RUNTIME, type Run, Sandbox, tail } from "./sandbox";

const version = inject("version");
const oldVersion = inject("oldVersion");

function expectClean(sb: Sandbox, r: Run) {
  expect(r.out, tail(r.out)).not.toMatch(BROKEN_RUNTIME);
  sb.expectOk(r);
}

async function installedVersion(sb: Sandbox) {
  return sb.expectOk(await sb.cli("version")).stdout.trim();
}

/** A package.json as init leaves it: scripts and devDependencies are always there. */
type PackageJson = { scripts: Record<string, string>; devDependencies: Record<string, string> };

function isPackageJson(v: unknown): v is PackageJson {
  return isRecord(v) && isStringMap(v.scripts) && isStringMap(v.devDependencies);
}

/** An agent host's hook config: hook groups keyed by event, when it has any. */
function isHookConfig(v: unknown): v is { hooks?: Record<string, unknown> } {
  return isRecord(v) && (v.hooks === undefined || isRecord(v.hooks));
}

function isClaudeSettings(v: unknown): v is { permissions: { allow: string[] } } {
  return isRecord(v) && isRecord(v.permissions) && isStringList(v.permissions.allow);
}

type HookCall = { file: string; event: string; matcher?: string; command: string };

/** Every command hook the consumer's agent hosts would run. */
function hookCalls(sb: Sandbox): HookCall[] {
  const files = [".claude/settings.json", ".codex/hooks.json", ".agents/hooks.json"];
  const grokDir = path.join(sb.repo, ".grok", "hooks");
  for (const f of fs.readdirSync(grokDir)) if (f.endsWith(".json") && f !== "package.json") files.push(`.grok/hooks/${f}`);
  const calls: HookCall[] = [];
  for (const file of files) {
    const hooks = sb.json(file, isHookConfig).hooks ?? {};
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
  { tool_name: "Agent", tool_input: { description: "look", prompt: "List the src folder.", subagent_type: "scout" } },
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
  // Create then Remove, in settings order, so the sandbox ends with no worktree.
  if (call.event === "WorktreeCreate") return [{ ...base, name: "e2e" }];
  if (call.event === "WorktreeRemove") return [{ ...base, worktree_path: path.join(sb.repo, ".worktrees", "e2e") }];
  return [{ ...base, stop_hook_active: false }];
}

describe("bunx", () => {
  describe("fresh repo", () => {
    let sb: Sandbox;

    beforeAll(async () => {
      sb = new Sandbox("fresh");
      await sb.scaffold();
      expectClean(sb, await sb.launch(PACKAGE_NAME, "init"));
    });

    it("installs this exact build as a devDependency", async () => {
      expect(await installedVersion(sb)).toBe(version);
      expect(JSON.stringify(sb.json("package.json", isPackageJson).devDependencies)).toContain(version);
    });

    it("writes the consumer tree and applies globals into HOME", () => {
      for (const rel of ["AGENTS.md", ".claude/settings.json", ".mcp.json", ".rulesync", ".rulesync/scripts/folder-map.ts"]) {
        expect(sb.exists(rel), rel).toBe(true);
      }
      for (const rel of ["CLAUDE.md", "GEMINI.md", ".gemini"]) {
        expect(sb.exists(rel), rel).toBe(false);
      }
      expect(sb.exists(".rulesync/scripts/job.ts")).toBe(true);
      expect(sb.exists("scripts")).toBe(false);
      expect(sb.exists(".rulesync/scripts/fixtures")).toBe(false);
      expect(fs.existsSync(path.join(sb.home, ".grok", "config.toml"))).toBe(true);
      const scripts = sb.json("package.json", isPackageJson).scripts;
      expect(scripts["repo:rulesync:generate"]).toBeTruthy();
      expect(scripts["repo:rulesync:check"]).toBeTruthy();
    });

    // Hook entry files run on import; the hook test below executes them instead.
    it("every shipped script module loads in the consumer", async () => {
      const files = fs.readdirSync(path.join(sb.repo, ".rulesync", "scripts")).filter((f) => f.endsWith(".ts")).map((f) => `.rulesync/scripts/${f}`);
      expect(files.length).toBeGreaterThan(20);
      const urls = files.map((f) => pathToFileURL(path.join(sb.repo, f)).href);
      const loader = path.join(sb.root, "load-scripts.ts");
      fs.writeFileSync(loader, `for (const u of ${JSON.stringify(urls)}) await import(u);\n`);
      expectClean(sb, await sb.run("bun", [loader]));
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
      const r = await sb.run("bash", ["-c", 'bun "$CLAUDE_PROJECT_DIR/.rulesync/scripts/session-map.ts"'], {
        input: JSON.stringify({ hook_event_name: "SessionStart", session_id: "e2e", cwd: sb.repo, source: "startup" }),
        env: { CLAUDE_PROJECT_DIR: sb.repo },
      });
      expectClean(sb, r);
      expect(r.stdout).toContain("src/");
    });

    it("runs scripts and hooks through the installed repo bin", async () => {
      const job = await sb.run("bash", ["-c", "cd src && bun repo job --job exec --query 'echo hi'"]);
      expectClean(sb, job);
      expect(job.stdout).toContain("hi");

      const env = { CLAUDE_PROJECT_DIR: sb.repo, GROK_WORKSPACE_ROOT: undefined };
      const gate = hookCalls(sb).find((c) => c.file === ".claude/settings.json" && c.event === "PreToolUse" && c.command.endsWith(" hook gate-fat-tools"));
      expect(gate, "claude gate hook").toBeDefined();
      const payload = { session_id: "e2e", cwd: sb.repo, hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "cat src/index.ts" } };
      const started = Date.now();
      const rewrite = await sb.run("bash", ["-c", gate!.command], { input: JSON.stringify(payload), env });
      expect(Date.now() - started).toBeLessThan(5000);
      expectClean(sb, rewrite);
      const out = JSON.parse(rewrite.stdout) as { hookSpecificOutput?: { updatedInput?: { command?: string } } };
      expect(out.hookSpecificOutput?.updatedInput?.command).toMatch(
        new RegExp(`^${fs.realpathSync(sb.repo).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/node_modules/\\.bin/repo job --job exec --query `),
      );

      const map = await sb.run("bash", ["-c", '"$CLAUDE_PROJECT_DIR/node_modules/.bin/repo" hook session-map'], {
        input: JSON.stringify({ hook_event_name: "SessionStart", session_id: "e2e", cwd: sb.repo, source: "startup" }),
        env,
      });
      expectClean(sb, map);
      expect(map.stdout).toContain("run `bun repo map <dir>`");

      expect(sb.json("package.json", isPackageJson).scripts["repo:doctor"]).toBe("repo doctor");
    });

    it("installed CLI subcommands work", async () => {
      expect(await installedVersion(sb)).toBe(version);
      expect(sb.expectOk(await sb.cli("help")).stdout).toContain("Usage: repo");
      expect(sb.expectOk(await sb.cli("map")).stdout).toContain("src/");
      for (const cmd of ["check", "sync-globals", "purge-mcps", "generate"]) {
        expectClean(sb, await sb.cli(cmd));
      }
    });

    it("package scripts run through bun", async () => {
      expectClean(sb, await sb.bunRun("repo:rulesync:check"));
      expectClean(sb, await sb.bunRun("repo:sync:globals"));
    });

    it("ships tsconfig bases with ts-reset, a vitest preset, and a check that keeps them", async () => {
      const pkgBefore = sb.read("package.json");
      const lockBefore = sb.read("bun.lock");
      const wrote = ["tsconfig.json", "src/parse.ts", "vitest.config.ts", "src/a.test.ts"];
      const tsconfig = { extends: "@workerstack/repo/tsconfig/bun", include: ["src"] };
      try {
        sb.write("tsconfig.json", `${JSON.stringify(tsconfig)}\n`);
        sb.write("src/parse.ts", 'const n: number = JSON.parse("1")\n');
        const tsc = await sb.run("bun", [path.join(sb.repo, "node_modules", "typescript", "bin", "tsc"), "-p", "."]);
        expect(tsc.status, tail(tsc.out)).toBe(2);
        expect(tsc.stdout).toContain("src/parse.ts(1,7): error TS2322: Type 'unknown' is not assignable to type 'number'.");
        expect(tsc.stdout).not.toContain("TS2688");

        sb.write("tsconfig.json", `${JSON.stringify({ ...tsconfig, files: [] })}\n`);
        const check = await sb.cli("check");
        expect(check.out, tail(check.out)).not.toMatch(BROKEN_RUNTIME);
        expect(check.status, tail(check.out)).toBe(1);
        expect(check.stderr).toContain(
          'tsconfig: tsconfig.json sets "files", which replaces the base\'s reset.d.ts. List sources under "include".',
        );
        sb.write("tsconfig.json", `${JSON.stringify(tsconfig)}\n`);
        expectClean(sb, await sb.cli("check"));

        expectClean(sb, await sb.run("bun", ["add", "-d", "vitest@^3.2.7"]));
        sb.write(
          "vitest.config.ts",
          'import { defineProject } from "@workerstack/repo/vitest"\nexport default defineProject({ test: { include: ["src/**/*.test.ts"] } })\n',
        );
        sb.write(
          "src/a.test.ts",
          'import { expect, it } from "vitest"\nimport { answer } from "./index"\nit("answers", () => expect(answer).toBe(42))\n',
        );
        const vitest = await sb.run("bunx", ["vitest", "run"], { env: { NO_COLOR: "1" } });
        expectClean(sb, vitest);
        expect(vitest.stdout).toMatch(/Tests\s+1 passed \(1\)/);
      } finally {
        // Leave the tree as init left it, so re-init below still finds nothing to change.
        for (const rel of wrote) fs.rmSync(path.join(sb.repo, rel), { force: true });
        sb.write("package.json", pkgBefore);
        sb.write("bun.lock", lockBefore);
      }
    });

    it("re-init is idempotent", async () => {
      await sb.commit("first init");
      expectClean(sb, await sb.launch(PACKAGE_NAME, "init"));
      expect((await sb.git("status", "--porcelain")).stdout).toBe("");
    });
  });

  it("upgrade self-updates an older install to latest", async () => {
    const sb = new Sandbox("upgrade");
    await sb.scaffold();
    expectClean(sb, await sb.launch(`${PACKAGE_NAME}@${oldVersion}`, "init"));
    expect(await installedVersion(sb)).toBe(oldVersion);
    expectClean(sb, await sb.cli("upgrade"));
    expect(await installedVersion(sb)).toBe(version);
    expect(JSON.stringify(sb.json("package.json", isPackageJson).devDependencies)).toContain(version);
  });
});

describe("existing repo content survives init", () => {
  it("keeps user scripts, deps, guarded markdown, and Claude settings", async () => {
    const sb = new Sandbox("existing");
    await sb.scaffold({ scripts: { build: "tsc -p ." }, devDependencies: { typescript: "^5.9.3" } });
    sb.write("AGENTS.md", "# Team rules\n\nAlways run the linter.\n");
    sb.write(".claude/settings.json", `${JSON.stringify({ permissions: { allow: ["Bash(make test)"] } }, null, 2)}\n`);
    await sb.commit("existing content");
    expectClean(sb, await sb.launch(PACKAGE_NAME, "init"));

    const pkg = sb.json("package.json", isPackageJson);
    expect(pkg.scripts.build).toBe("tsc -p .");
    expect(pkg.devDependencies.typescript).toBe("^5.9.3");
    expect(sb.read("AGENTS.md")).toContain("Always run the linter.");
    expect(sb.json(".claude/settings.json", isClaudeSettings).permissions.allow).toContain("Bash(make test)");
  });
});
