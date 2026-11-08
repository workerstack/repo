/**
 * The published package, end to end: launch it the way users do (bunx) from a real
 * registry into real consumer repos, then use what it installed. Init copies nothing:
 * `bun install` runs `repo sync` (postinstall), which generates the gitignored agent trees.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, inject, it } from "vitest";
import { isRecord, isStringList, isStringMap } from "./json";
import { PACKAGE_NAME } from "./registry";
import { BROKEN_RUNTIME, type Run, Sandbox, tail } from "./sandbox";

const version = inject("version");
const oldVersion = inject("oldVersion");
const registryUrl = inject("registryUrl");

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

function isClaudeSettings(v: unknown): v is { permissions: { allow: string[] } } {
  return isRecord(v) && isRecord(v.permissions) && isStringList(v.permissions.allow);
}

/** An agent host's hook config: hook groups keyed by event, when it has any. */
function isHookConfig(v: unknown): v is { hooks?: Record<string, unknown> } {
  return isRecord(v) && (v.hooks === undefined || isRecord(v.hooks));
}

/** Every path `repo sync` generates for the default config; none is tracked in the consumer. */
const GENERATED = ["AGENTS.md", ".mcp.json", ".claude", ".codex", ".agents", ".grok", ".cursor"];

/** Dependencies, git internals and the hooks' scratch dirs are not sync output. */
const SKIPPED = /^(?:node_modules|\.git|\.tmp|\.worktrees)(?:\/|$)/;

const sha = (data: Buffer) => createHash("sha256").update(data).digest("hex");

/** One line per file (sha256 of its bytes) and per link (its target) that `keep` accepts, links never followed. */
function hashes(root: string, keep: (rel: string) => boolean, dir = ""): string[] {
  const lines: string[] = [];
  for (const name of fs.readdirSync(path.join(root, dir)).sort()) {
    const rel = dir ? `${dir}/${name}` : name;
    if (SKIPPED.test(rel)) continue;
    const abs = path.join(root, rel);
    const stat = fs.lstatSync(abs);
    if (stat.isSymbolicLink()) {
      if (keep(rel)) lines.push(`${rel} -> ${fs.readlinkSync(abs)}`);
    } else if (stat.isDirectory()) lines.push(...hashes(root, keep, rel));
    else if (keep(rel)) lines.push(`${rel} ${sha(fs.readFileSync(abs))}`);
  }
  return lines;
}

/**
 * The ignored, untracked files and links git sees: what `repo sync` generated. Git for Windows walks into a
 * junction and lists the files behind it, so each of those is folded back into the link that holds it.
 */
async function ignoredFiles(sb: Sandbox) {
  const out = (await sb.git("ls-files", "--others", "--ignored", "--exclude-standard", "-z")).stdout;
  const listed = out.split("\0").filter((f) => f && !SKIPPED.test(f));
  return [...new Set(listed.map((rel) => holdingLink(sb.repo, rel) ?? rel))];
}

/** The nearest parent of `rel` that is a link, or null when every parent is a real directory. */
function holdingLink(root: string, rel: string): string | null {
  const parts = rel.split("/");
  for (let i = 1; i < parts.length; i++) {
    const parent = parts.slice(0, i).join("/");
    if (fs.lstatSync(path.join(root, parent)).isSymbolicLink()) return parent;
  }
  return null;
}

/** Removes a generated file, or a generated link without touching what it points to. */
function removeGenerated(abs: string) {
  if (fs.lstatSync(abs, { throwIfNoEntry: false })?.isSymbolicLink()) fs.unlinkSync(abs);
  else fs.rmSync(abs, { force: true });
}

async function generatedHashes(sb: Sandbox) {
  const ignored = new Set(await ignoredFiles(sb));
  return hashes(sb.repo, (rel) => ignored.has(rel));
}

/** Overwrite the config's `agents.hosts` list. */
function setHosts(sb: Sandbox, hosts: string[]) {
  const text = sb.read("workerstack.config.ts");
  expect(text).toMatch(/hosts: \[[^\]]*\]/);
  sb.write("workerstack.config.ts", text.replace(/hosts: \[[^\]]*\]/, `hosts: ${JSON.stringify(hosts)}`));
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

function claudeGate(sb: Sandbox) {
  const gate = hookCalls(sb).find((c) => c.file === ".claude/settings.json" && c.event === "PreToolUse" && c.command.endsWith(" hook gate-fat-tools"));
  expect(gate, "claude gate hook").toBeDefined();
  return gate!;
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

    it("init copies nothing: it writes the config and a postinstall, and install generates the trees", () => {
      expect(sb.exists("workerstack.config.ts")).toBe(true);
      expect(sb.json("package.json", isPackageJson).scripts.postinstall).toBe("repo sync --postinstall");
      for (const rel of [".rulesync", "scripts"]) expect(sb.exists(rel), rel).toBe(false);
      for (const rel of GENERATED) expect(sb.exists(rel), rel).toBe(true);
      for (const rel of ["CLAUDE.md", "GEMINI.md", ".gemini"]) expect(sb.exists(rel), rel).toBe(false);
      expect(fs.existsSync(path.join(sb.home, ".grok", "config.toml"))).toBe(true);
      const scripts = sb.json("package.json", isPackageJson).scripts;
      expect(Object.keys(scripts).filter((k) => k.startsWith("repo:"))).toEqual([]);
    });

    it("tracks none of the generated paths, and sync --check exits 0", async () => {
      await sb.commit("after init");
      const tracked = (await sb.git("ls-files")).stdout.split("\n").filter(Boolean);
      expect(tracked.filter((f) => GENERATED.some((g) => f === g || f.startsWith(`${g}/`)))).toEqual([]);
      expect((await sb.git("status", "--porcelain")).stdout).toBe("");
      const ignored = await ignoredFiles(sb);
      for (const rel of GENERATED) expect(ignored.some((f) => f === rel || f.startsWith(`${rel}/`)), rel).toBe(true);
      const check = await sb.run("bun", ["repo", "sync", "--check"]);
      expectClean(sb, check);
      expect(check.stdout).toContain("up to date");
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

    it("runs scripts and hooks through the installed repo bin", async () => {
      const job = await sb.run("bash", ["-c", "cd src && bun repo job --job exec --query 'echo hi'"]);
      expectClean(sb, job);
      expect(job.stdout).toContain("hi");

      const env = { CLAUDE_PROJECT_DIR: sb.repo, GROK_WORKSPACE_ROOT: undefined };
      const payload = { session_id: "e2e", cwd: sb.repo, hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "cat src/index.ts" } };
      const rewrite = await sb.run("bash", ["-c", claudeGate(sb).command], { input: JSON.stringify(payload), env });
      expectClean(sb, rewrite);
      const out = JSON.parse(rewrite.stdout) as { hookSpecificOutput?: { updatedInput?: { command?: string } } };
      expect(out.hookSpecificOutput?.updatedInput?.command).toMatch(
        new RegExp(`^${fs.realpathSync(sb.repo).split(path.sep).join("/").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/node_modules/\\.bin/repo job --job exec --query `),
      );

      const map = await sb.run("bash", ["-c", '"$CLAUDE_PROJECT_DIR/node_modules/.bin/repo" hook session-map'], {
        input: JSON.stringify({ hook_event_name: "SessionStart", session_id: "e2e", cwd: sb.repo, source: "startup" }),
        env,
      });
      expectClean(sb, map);
      expect(map.stdout).toContain("run `bun repo map <dir>`");
      expect(map.stdout).toContain("src/");
    });

    it("the generated gate allows a stock reference and denies a dependency, each within 5s", async () => {
      const stock = path.join("node_modules", PACKAGE_NAME, "references");
      expect(sb.exists(path.join(stock, "plan-format.md"))).toBe(true);

      const index = sb.read("references/INDEX.md");
      const section = /<!-- repo:stack -->\n([\s\S]*?)<!-- \/repo:stack -->/.exec(index)?.[1] ?? "";
      const targets = [...section.matchAll(/\]\(([^)]+)\)/g)].map((m) => m[1] ?? "");
      expect(targets, section).toContain(`../node_modules/${PACKAGE_NAME}/references/INDEX.md`);
      for (const target of targets) expect(sb.exists(path.join("references", target)), target).toBe(true);

      const gate = claudeGate(sb);
      const env = { CLAUDE_PROJECT_DIR: sb.repo, GROK_WORKSPACE_ROOT: undefined };
      const read = async (rel: string) => {
        const payload = { session_id: "e2e", cwd: sb.repo, hook_event_name: "PreToolUse", tool_name: "Read", tool_input: { file_path: path.join(sb.repo, rel) } };
        const started = Date.now();
        const r = await sb.run("bash", ["-c", gate.command], { input: JSON.stringify(payload), env });
        const ms = Date.now() - started;
        process.stdout.write(`gate latency ${ms}ms for Read ${rel}\n`);
        expect(ms, `${rel} took ${ms}ms`).toBeLessThan(5000);
        expect(r.out, tail(r.out)).not.toMatch(BROKEN_RUNTIME);
        const decision = (JSON.parse(r.stdout || "{}") as { hookSpecificOutput?: { permissionDecision?: string } }).hookSpecificOutput?.permissionDecision;
        return { status: r.status, decision, out: r.out };
      };
      const allowed = await read(path.join(stock, "plan-format.md"));
      expect(allowed.decision, allowed.out).not.toBe("deny");
      expect(allowed.status, allowed.out).toBe(0);
      const denied = await read(path.join("node_modules", "rulesync", "package.json"));
      expect(denied.decision, denied.out).toBe("deny");
    });

    it("deleting every ignored generated file and running bun install reproduces each byte for byte", async () => {
      const before = await generatedHashes(sb);
      expect(before.length).toBeGreaterThan(50);
      expect(before.some((l) => l.includes(" -> ")), "links").toBe(true);
      for (const rel of await ignoredFiles(sb)) removeGenerated(path.join(sb.repo, rel));
      expect((await generatedHashes(sb)).length).toBe(0);
      expectClean(sb, await sb.run("bun", ["install"]));
      expect(await generatedHashes(sb)).toEqual(before);
      expect((await sb.git("status", "--porcelain")).stdout).toBe("");
    });

    it("sync works with the registry unreachable", async () => {
      const before = await generatedHashes(sb);
      fs.rmSync(path.join(sb.repo, ".claude", "settings.json"));
      fs.rmSync(path.join(sb.repo, "AGENTS.md"));
      expect(registryUrl).not.toContain("127.0.0.1:9/");
      const offline = { BUN_CONFIG_REGISTRY: "http://127.0.0.1:9/", HTTP_PROXY: "http://127.0.0.1:9", HTTPS_PROXY: "http://127.0.0.1:9" };
      expectClean(sb, await sb.run("bun", ["repo", "sync"], { env: offline }));
      expect(await generatedHashes(sb)).toEqual(before);
    });

    it("an unknown config key fails sync, while install prints it, exits 0 and changes no file", async () => {
      const original = sb.read("workerstack.config.ts");
      sb.write("workerstack.config.ts", original.replace("agents:", "bogusKey: true,\n  agents:"));
      try {
        const keep = () => true;
        const before = hashes(sb.repo, keep);
        const sync = await sb.run("bun", ["repo", "sync"]);
        expect(sync.status, tail(sync.out)).toBe(1);
        expect(sync.stderr).toContain('unknown key "bogusKey"');
        const install = await sb.run("bun", ["install"]);
        expect(install.status, tail(install.out)).toBe(0);
        expect(install.out).toContain('unknown key "bogusKey"');
        expect(hashes(sb.repo, keep)).toEqual(before);
      } finally {
        sb.write("workerstack.config.ts", original);
      }
      expectClean(sb, await sb.run("bun", ["repo", "sync", "--check"]));
    });

    it("limiting agents.hosts prunes the other trees, and restoring them brings the trees back", async () => {
      const before = await generatedHashes(sb);
      const original = sb.read("workerstack.config.ts");
      try {
        setHosts(sb, ["claude"]);
        expectClean(sb, await sb.run("bun", ["repo", "sync"]));
        for (const rel of [".codex", ".agents", ".grok", ".cursor"]) expect(sb.exists(rel), rel).toBe(false);
        for (const rel of ["AGENTS.md", ".mcp.json", ".claude/settings.json"]) expect(sb.exists(rel), rel).toBe(true);
        expectClean(sb, await sb.run("bun", ["repo", "sync", "--check"]));
      } finally {
        sb.write("workerstack.config.ts", original);
        await sb.run("bun", ["repo", "sync"]);
      }
      expect(await generatedHashes(sb)).toEqual(before);
    });

    it("installed CLI subcommands work", async () => {
      expect(await installedVersion(sb)).toBe(version);
      expect(sb.expectOk(await sb.cli("help")).stdout).toContain("Usage: repo");
      expect(sb.expectOk(await sb.cli("map")).stdout).toContain("src/");
      for (const cmd of ["check", "sync", "sync-globals", "purge-mcps"]) {
        expectClean(sb, await sb.cli(cmd));
      }
      for (const cmd of ["generate", "upgrade"]) {
        const r = await sb.cli(cmd);
        expect(r.status, cmd).not.toBe(0);
        expect(r.stderr).toContain(`unknown command "${cmd}"`);
      }
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

  it("a copied install from the older build migrates when bumped, keeping its own rule", async () => {
    const sb = new Sandbox("upgrade");
    await sb.scaffold();
    expectClean(sb, await sb.launch(`${PACKAGE_NAME}@${oldVersion}`, "init", "--yes", "--packs", "none"));
    expect(await installedVersion(sb)).toBe(oldVersion);
    expect(sb.exists(".rulesync/scripts"), "the older init copies the scripts").toBe(true);
    const own = "Our team notes: ship on Fridays only with a rollback plan.";
    sb.write(".rulesync/rules/team.md", `---\nroot: false\ntargets: ["*"]\n---\n${own}\n`);
    await sb.commit("older init and own rule");

    // The bump's install runs the postinstall sync, which migrates the copied install.
    const bump = await sb.run("bun", ["add", "-d", `${PACKAGE_NAME}@${version}`]);
    expectClean(sb, bump);
    expect(await installedVersion(sb)).toBe(version);
    expect(bump.out).toContain("repo sync: moved .rulesync/rules/team.md to .repo/rules/team.md");
    expect(bump.out).toContain("and removed the copied .rulesync/; commit the result");
    expect(sb.exists(".rulesync")).toBe(false);
    expect(sb.read(".repo/rules/team.md")).toContain(own);
    expect(sb.read("AGENTS.md")).toContain(own);

    await sb.commit("migrated");
    const tracked = (await sb.git("ls-files")).stdout.split("\n").filter(Boolean);
    expect(tracked.filter((f) => /^(?:\.rulesync|\.claude|\.codex|\.agents|\.grok|\.cursor)\//.test(f) || f === "AGENTS.md")).toEqual([]);
    expect(tracked).toContain(".repo/rules/team.md");
    const again = await sb.run("bun", ["install"]);
    expectClean(sb, again);
    expect(again.out).not.toContain("moved");
    expectClean(sb, await sb.run("bun", ["repo", "sync", "--check"]));
  });
});

describe("existing repo content survives init", () => {
  it("keeps user scripts, dependencies, AGENTS.md text and Claude settings keys", async () => {
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
    expect(sb.read(".repo/rules/agents.md")).toContain("Always run the linter.");
    expect(sb.json(".claude/settings.json", isClaudeSettings).permissions.allow).toContain("Bash(make test)");
    expect((await sb.git("ls-files")).stdout.split("\n")).not.toContain("AGENTS.md");
  });
});
