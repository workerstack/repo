/**
 * The published package, end to end: launch it the way users do (bunx) from a real
 * registry into real consumer repos, then use what it installed. Init copies nothing:
 * `bun install` runs `repo sync` (postinstall), which generates the gitignored agent trees.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { parse } from "jsonc-parser";
import { beforeAll, describe, expect, inject, it } from "vitest";
import { isRecord, isStringList, isStringMap } from "./json";
import { PACKAGE_NAME } from "./registry";
import { BROKEN_RUNTIME, type Run, Sandbox, tail } from "./sandbox";
import { readEnv } from "../cli/env.ts";
import { nodelessPath } from "../dev/nodeless-path.ts";
import { installedBin, linkText } from "../dev/test-paths.ts";

const version = inject("version");
const oldVersion = inject("oldVersion");
const registryUrl = inject("registryUrl");

function expectClean(sb: Sandbox, r: Run) {
  expect(r.out, tail(r.out)).not.toMatch(BROKEN_RUNTIME);
  sb.expectOk(r);
}

/** `repo turn` and `repo check` both fail the planted file's non-null assertion against an empty baseline. */
async function expectPlantedFails(sb: Sandbox, env: Record<string, string>) {
  const turn = await sb.run("bun", ["repo", "turn"], { env });
  expect(turn.status, tail(turn.out)).toBe(1);
  expect(turn.stderr).toContain(
    "repo turn: src/planted.ts has 1 typescript(no-non-null-assertion), the baseline allows 0; fix the new one",
  );
  expect(turn.stdout).toMatch(/^turn: 1 file · fmt ok · comments ok · lint 2 over baseline · /);
  const check = await sb.run("bun", ["repo", "check"], { env });
  expect(check.status, tail(check.out)).toBe(1);
  expect(check.stderr).toContain(
    "repo check: .repo/lint-baseline.json: src/planted.ts has 1 typescript(no-non-null-assertion), the baseline allows 0",
  );
}

const SKIP_REASON = "the lookup result is always present";
const skipOf = (file: string, rule = "typescript/no-non-null-assertion") => ({
  files: [file],
  rules: [rule],
  reason: SKIP_REASON,
});

/**
 * With `src/skipped.ts` planted: check reports the live skip and fails the one whose file is gone, leaving no
 * skip-free config behind, and sync refuses a skip of a rule the config never runs.
 */
async function expectSkipsChecked(sb: Sandbox, original: string) {
  const withSkips = (...skips: object[]) =>
    original.replace("packs:", `lint: { skip: ${JSON.stringify(skips)} },\n  packs:`);
  sb.write("workerstack.config.ts", withSkips(skipOf("src/skipped.ts"), skipOf("src/gone.ts")));
  expectClean(sb, await sb.run("bun", ["repo", "sync"]));
  const check = await sb.run("bun", ["repo", "check"]);
  expect(check.status, tail(check.out)).toBe(1);
  expect(check.stdout).toContain(
    `repo check: skip typescript/no-non-null-assertion in src/skipped.ts: 1 hit (${SKIP_REASON})\n` +
      "repo check: skips: typescript/no-non-null-assertion 1\n",
  );
  expect(check.stderr).toContain(
    'repo check: lint.skip[1]: "src/gone.ts" matches no file; fix the path or delete the entry',
  );
  expect(fs.readdirSync(sb.repo).filter((name) => name.startsWith(".oxlintrc.unskipped-"))).toEqual([]);
  sb.write("workerstack.config.ts", withSkips(skipOf("src/skipped.ts", "repo/no-modul-state")));
  const sync = await sb.run("bun", ["repo", "sync"]);
  expect(sync.status, tail(sync.out)).toBe(1);
  expect(sync.stderr).toContain(
    'repo sync: workerstack.config.ts: lint.skip[0].rules: "repo/no-modul-state" is not a rule the generated config runs',
  );
}

/** On a clean tree `repo turn` has nothing to gate and `repo check` passes. */
async function expectGatesPass(sb: Sandbox, env: Record<string, string>) {
  const turn = await sb.run("bun", ["repo", "turn"], { env });
  expect({ status: turn.status, stdout: turn.stdout }, tail(turn.out)).toEqual({
    status: 0,
    stdout: "turn: no changes\n",
  });
  expectClean(sb, await sb.run("bun", ["repo", "check"], { env }));
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
const GENERATED = [".claude", ".codex", ".agents", ".grok", ".cursor", ".oxlintrc.json", ".oxfmtrc.jsonc", "knip.json"];

const NON_NULL = 'export function first(names: string[]): string {\n  return names.find((name) => name !== "")!;\n}\n';
const FLOATING = "export function start(load: () => Promise<void>): void {\n  load();\n}\n";

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
      if (keep(rel)) lines.push(`${rel} -> ${linkText(abs)}`);
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
  for (const f of fs.readdirSync(grokDir)) if (f.endsWith(".json")) files.push(`.grok/hooks/${f}`);
  const calls: HookCall[] = [];
  for (const file of files) {
    const hooks = sb.json(file, isHookConfig).hooks ?? {};
    for (const [event, groups] of Object.entries(hooks)) {
      if (!Array.isArray(groups)) continue;
      for (const g of groups as { matcher?: string; hooks?: { type: string; command: string }[] }[]) {
        for (const h of g.hooks ?? [])
          if (h.type === "command") calls.push({ file, event, matcher: g.matcher, command: h.command });
      }
    }
  }
  return calls;
}

function claudeGate(sb: Sandbox) {
  const gate = hookCalls(sb).find(
    (c) => c.file === ".claude/settings.json" && c.event === "PreToolUse" && c.command.endsWith(" hook gate-fat-tools"),
  );
  expect(gate, "claude gate hook").toBeDefined();
  return gate!;
}

const TOOL_CALLS = [
  { tool_name: "Read", tool_input: { file_path: "src/index.ts" } },
  { tool_name: "Bash", tool_input: { command: "git status", description: "status" } },
  { tool_name: "Agent", tool_input: { description: "look", prompt: "List the src folder.", subagent_type: "scout" } },
];

function hookPayloads(sb: Sandbox, call: HookCall) {
  const base = {
    session_id: "e2e-session",
    cwd: sb.repo,
    transcript_path: path.join(sb.root, "transcript.jsonl"),
    hook_event_name: call.event,
  };
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

    it("writes private, sideEffects and a pinned bun, so repo check passes", async () => {
      const pkg = sb.json("package.json", (v): v is Record<string, unknown> => typeof v === "object" && v !== null);
      expect(pkg).toMatchObject({ private: true, sideEffects: false });
      expect(pkg.packageManager).toMatch(/^bun@\d+\.\d+\.\d+/);
      expectClean(sb, await sb.run("bun", ["repo", "check"]));
    });

    it("tracks none of the generated paths, and sync --check exits 0", async () => {
      await sb.commit("after init");
      const tracked = (await sb.git("ls-files")).stdout.split("\n").filter(Boolean);
      expect(tracked.filter((f) => GENERATED.some((g) => f === g || f.startsWith(`${g}/`)))).toEqual([]);
      // AGENTS.md holds the user's text below its region and .mcp.json is the user's: both are tracked.
      expect(tracked).toEqual(expect.arrayContaining(["AGENTS.md", ".mcp.json"]));
      expect((await sb.git("status", "--porcelain")).stdout).toBe("");
      const ignored = await ignoredFiles(sb);
      for (const rel of GENERATED)
        expect(
          ignored.some((f) => f === rel || f.startsWith(`${rel}/`)),
          rel,
        ).toBe(true);
      const check = await sb.run("bun", ["repo", "sync", "--check"]);
      expectClean(sb, check);
      expect(check.stdout).toContain("up to date");
    });

    it.skipIf(process.platform === "win32")(
      "with node off PATH, fmt --check passes on the fresh consumer, and lint, turn and check fail a planted non-null assertion and floating promise until it is gone",
      async () => {
        const env = { PATH: nodelessPath(sb.root, readEnv().PATH ?? "") };
        expect((await sb.run("sh", ["-c", "command -v node"], { env })).status).not.toBe(0);
        const fmt = await sb.run("bun", ["repo", "fmt", "--check"], { env });
        expect(fmt.status, tail(fmt.out)).toBe(0);
        expect(fmt.stdout).toContain("All matched files use the correct format");
        sb.write("src/planted.ts", `${NON_NULL}\n${FLOATING}`);
        try {
          const lint = await sb.run("bun", ["repo", "lint"], { env });
          expect(lint.status, tail(lint.out)).toBe(1);
          expect(lint.out).toContain("no-non-null-assertion");
          expect(lint.out).toContain("no-floating-promises");
          await expectPlantedFails(sb, env);
        } finally {
          fs.rmSync(path.join(sb.repo, "src/planted.ts"));
        }
        await expectGatesPass(sb, env);
      },
    );

    it("lint loads the repo plugin from the install: a module let and a bare import fail until they are gone", async () => {
      sb.write("src/stateful.ts", "let count = 0;\nexport const next = (): number => ++count;\n");
      sb.write("src/polyfill.ts", 'import "./stateful.ts";\n');
      try {
        const lint = await sb.run("bun", ["repo", "lint"]);
        expect(lint.status, tail(lint.out)).toBe(1);
        expect(lint.out).toContain("repo(no-module-state)");
        expect(lint.out).toContain("repo(no-side-effect-import)");
      } finally {
        for (const rel of ["src/stateful.ts", "src/polyfill.ts"]) fs.rmSync(path.join(sb.repo, rel));
      }
      expectClean(sb, await sb.run("bun", ["repo", "lint"]));
    });

    it("check prints a live lint.skip and fails a stale one, and a skip of an unknown rule fails sync", async () => {
      const original = sb.read("workerstack.config.ts");
      sb.write("src/skipped.ts", NON_NULL);
      try {
        await expectSkipsChecked(sb, original);
      } finally {
        fs.rmSync(path.join(sb.repo, "src/skipped.ts"));
        sb.write("workerstack.config.ts", original);
        await sb.run("bun", ["repo", "sync"]);
      }
      expect(sb.read(".oxlintrc.json")).not.toContain("src/skipped.ts");
      expectClean(sb, await sb.run("bun", ["repo", "sync", "--check"]));
    });

    it("points core.hooksPath at tracked, executable hooks, so git commit runs turn and the message check", async () => {
      expect((await sb.git("config", "core.hooksPath")).stdout).toBe(".githooks\n");
      expect((await sb.git("ls-files", "-s", ".githooks")).stdout).toMatch(
        /^100755 \w+ 0\t\.githooks\/commit-msg\n100755 \w+ 0\t\.githooks\/pre-commit\n100755 \w+ 0\t\.githooks\/pre-push\n$/,
      );
      const commit = (message: string) => sb.run("git", ["commit", "-q", "-m", message]);
      sb.write("src/planted.ts", NON_NULL);
      await sb.git("add", "src/planted.ts");
      const planted = await commit("chore: plant");
      expect(planted.status, tail(planted.out)).toBe(1);
      expect(planted.stderr).toContain(
        "repo turn: src/planted.ts has 1 typescript(no-non-null-assertion), the baseline allows 0; fix the new one",
      );
      await sb.git("rm", "-q", "--cached", "src/planted.ts");
      fs.rmSync(path.join(sb.repo, "src/planted.ts"));
      sb.write("src/feature.ts", "export const feature = 1;\n");
      sb.write("src/index.ts", `${sb.read("src/index.ts")}export { feature } from "./feature.ts";\n`);
      await sb.git("add", "src/feature.ts", "src/index.ts");
      const untested = await commit("feat: add the feature");
      expect(untested.status, tail(untested.out)).toBe(1);
      expect(untested.stderr).toContain(
        "commit-msg: the message was refused\n  - a feat commit must include a test change (a *.test.* or *.spec.* file, or a file under e2e/)\n",
      );
      const clean = await commit("chore: add the feature");
      expect(clean.status, tail(clean.out)).toBe(0);
      expect((await sb.git("log", "-1", "--format=%s")).stdout).toBe("chore: add the feature\n");
    });

    it("writes the gitignore and gitattributes blocks and the editor read-only globs from the planned outputs", () => {
      const block = (text: string) =>
        /^# repo:(ignore|generated) [\da-f]{8}\n([\s\S]*?)^# \/repo:\1$/m.exec(text)?.[2]?.split("\n").filter(Boolean);
      expect(block(sb.read(".gitignore"))).toEqual([
        ".tmp/",
        ".worktrees/",
        ".repo/tmp/",
        "coverage/",
        "node_modules/",
        "knip.json",
        "knip.unignored-*.json",
        ".oxfmtrc.jsonc",
        ".oxlintrc.json",
        ".oxlintrc.unskipped-*.json",
        ".agents/",
        ".claude/",
        ".codex/",
        ".cursor/",
        ".grok/",
      ]);
      const attributes = block(sb.read(".gitattributes")) ?? [];
      expect(attributes[0]).toBe("* text=auto eol=lf");
      expect(attributes).toContain("bunfig.toml linguist-generated");
      expect(attributes).toContain(".vscode/tasks.json linguist-generated");
      // The untracked trees are ignored, not marked generated; the block files are never marked.
      expect(
        attributes.filter((line) =>
          /^(?:AGENTS\.md|\.mcp\.json|\.claude|\.codex|\.agents|\.grok|\.cursor|\.gitignore|\.gitattributes)/.test(
            line,
          ),
        ),
      ).toEqual([]);
      const readonly = parse(sb.read(".vscode/settings.json"))["files.readonlyInclude"] as Record<string, boolean>;
      expect(readonly).toMatchObject({ ".claude/settings.json": true, "bunfig.toml": true });
      for (const yours of [".gitignore", "AGENTS.md", ".mcp.json"]) expect(Object.keys(readonly)).not.toContain(yours);
    });

    it("every agent-host hook runs without crashing", async () => {
      const calls = hookCalls(sb);
      expect(calls.length).toBeGreaterThan(5);
      for (const call of calls) {
        for (const payload of hookPayloads(sb, call)) {
          const r = await sb.run("bash", ["-c", call.command], {
            input: JSON.stringify(payload),
            env: {
              CLAUDE_PROJECT_DIR: sb.repo,
              ...(call.file.startsWith(".grok") ? { GROK_WORKSPACE_ROOT: sb.repo } : {}),
            },
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
      const payload = {
        session_id: "e2e",
        cwd: sb.repo,
        hook_event_name: "PreToolUse",
        tool_name: "Bash",
        tool_input: { command: "cat src/index.ts" },
      };
      const rewrite = await sb.run("bash", ["-c", claudeGate(sb).command], { input: JSON.stringify(payload), env });
      expectClean(sb, rewrite);
      const out = JSON.parse(rewrite.stdout) as { hookSpecificOutput?: { updatedInput?: { command?: string } } };
      expect(out.hookSpecificOutput?.updatedInput?.command).toMatch(
        new RegExp(`^${installedBin(sb.repo).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} job --job exec --query `),
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
      const section = /<!-- repo:stack [\da-f]{8} -->\n([\s\S]*?)<!-- \/repo:stack -->/.exec(index)?.[1] ?? "";
      const targets = [...section.matchAll(/\]\(([^)]+)\)/g)].map((m) => m[1] ?? "");
      expect(targets, section).toContain(`../node_modules/${PACKAGE_NAME}/references/INDEX.md`);
      for (const target of targets) expect(sb.exists(path.join("references", target)), target).toBe(true);

      const gate = claudeGate(sb);
      const env = { CLAUDE_PROJECT_DIR: sb.repo, GROK_WORKSPACE_ROOT: undefined };
      const read = async (rel: string) => {
        const payload = {
          session_id: "e2e",
          cwd: sb.repo,
          hook_event_name: "PreToolUse",
          tool_name: "Read",
          tool_input: { file_path: path.join(sb.repo, rel) },
        };
        const started = Date.now();
        const r = await sb.run("bash", ["-c", gate.command], { input: JSON.stringify(payload), env });
        const ms = Date.now() - started;
        process.stdout.write(`gate latency ${ms}ms for Read ${rel}\n`);
        expect(ms, `${rel} took ${ms}ms`).toBeLessThan(5000);
        expect(r.out, tail(r.out)).not.toMatch(BROKEN_RUNTIME);
        const decision = (JSON.parse(r.stdout || "{}") as { hookSpecificOutput?: { permissionDecision?: string } })
          .hookSpecificOutput?.permissionDecision;
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
      expect(
        before.some((l) => l.includes(" -> ")),
        "links",
      ).toBe(true);
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
      const offline = {
        BUN_CONFIG_REGISTRY: "http://127.0.0.1:9/",
        HTTP_PROXY: "http://127.0.0.1:9",
        HTTPS_PROXY: "http://127.0.0.1:9",
      };
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
      for (const cmd of ["check", "sync", "yolo", "purge-mcps"]) {
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
      const wrote = ["tsconfig.json", "tsconfig.src.json", "src/main.ts", "vitest.config.ts", "src/a.test.ts"];
      const tsconfig = { extends: "@workerstack/repo/tsconfig/bun", include: ["src"] };
      const srcTsconfig = {
        extends: ["./tsconfig.json", "@workerstack/repo/tsconfig/strict"],
        exclude: ["node_modules", "**/*.test.ts"],
      };
      try {
        sb.write("tsconfig.json", `${JSON.stringify(tsconfig)}\n`);
        sb.write("tsconfig.src.json", `${JSON.stringify(srcTsconfig)}\n`);
        // Pure-marked, so repo(no-module-side-effects) passes and only the type error is left.
        sb.write("src/main.ts", 'const n: number = /* @__PURE__ */ JSON.parse("1")\n');
        const tsc = await sb.run("bun", [path.join(sb.repo, "node_modules", "typescript", "bin", "tsc"), "-p", "."]);
        expect(tsc.status, tail(tsc.out)).toBe(2);
        expect(tsc.stdout).toContain(
          "src/main.ts(1,7): error TS2322: Type 'unknown' is not assignable to type 'number'.",
        );
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

  it("a copied install from the older build migrates when bumped, writes the release ci.yml and keeps its own rule", async () => {
    const sb = new Sandbox("upgrade");
    await sb.scaffold();
    expectClean(sb, await sb.launch(`${PACKAGE_NAME}@${oldVersion}`, "init", "--yes", "--packs", "none"));
    expect(await installedVersion(sb)).toBe(oldVersion);
    expect(sb.exists(".rulesync/scripts"), "the older init copies the scripts").toBe(true);
    const own = "Our team notes: ship on Fridays only with a rollback plan.";
    sb.write(".rulesync/rules/team.md", `---\nroot: false\ntargets: ["*"]\n---\n${own}\n`);
    const agent =
      "---\nname: release-notes\ndescription: Drafts our release notes.\n---\nWrite the notes from the merged pull requests.\n";
    const skill =
      "---\nname: deploy-notes\ndescription: How we deploy on Fridays.\n---\nAlways attach the rollback plan.\n";
    sb.write(".rulesync/subagents/release-notes.md", agent);
    sb.write(".agents/skills/deploy-notes/SKILL.md", skill);
    await sb.commit("older init and own rule");

    // The bump's install runs the postinstall sync, which migrates the copied install.
    const bump = await sb.run("bun", ["add", "-d", `${PACKAGE_NAME}@${version}`]);
    expect(await installedVersion(sb)).toBe(version);
    // Every pack the older build wrote is a pack again, so the bump's own sync migrates and writes the release ci.yml.
    expect(bump.out).not.toContain("is not a pack");
    const migrate = bump;
    expectClean(sb, migrate);
    // The new build rewrites the older build's legacy header line with its own.
    expect(sb.read(".github/workflows/ci.yml")).toMatch(/^# @generated by @workerstack\/repo\n/);
    expect(migrate.out).toContain("repo sync: moved .rulesync/rules/team.md to .repo/rules/team.md");
    expect(migrate.out).toContain("and removed the copied .rulesync/; commit the result");
    expect(sb.exists(".rulesync")).toBe(false);
    // The upgraded rule has no paths, so the handover moves it below the region of AGENTS.md.
    expect(migrate.out).toContain("repo sync: moved .repo/rules/team.md into AGENTS.md below repo:rules");
    expect(sb.exists(".repo/rules/team.md")).toBe(false);
    expect(sb.read("AGENTS.md").split("<!-- /repo:rules -->\n")[1]).toContain(own);
    expect(migrate.out).toContain(
      "repo sync: moved .rulesync/subagents/release-notes.md to .repo/subagents/release-notes.md",
    );
    expect(migrate.out).toContain("repo sync: moved .agents/skills/deploy-notes to .repo/skills/deploy-notes");
    expect(sb.read(".repo/subagents/release-notes.md")).toBe(agent);
    expect(sb.read(".repo/skills/deploy-notes/SKILL.md")).toBe(skill);
    expect(sb.read(".claude/agents/release-notes.md")).toContain("Write the notes from the merged pull requests.");
    expect(sb.read(".claude/skills/deploy-notes/SKILL.md")).toBe(skill);

    await sb.commit("migrated");
    const tracked = (await sb.git("ls-files")).stdout.split("\n").filter(Boolean);
    expect(tracked.filter((f) => /^(?:\.rulesync|\.claude|\.codex|\.agents|\.grok|\.cursor)\//.test(f))).toEqual([]);
    expect(tracked).toContain("AGENTS.md");
    const again = await sb.run("bun", ["install"]);
    expectClean(sb, again);
    expect(again.out).not.toContain("moved");
    const second = await sb.run("bun", ["repo", "sync"]);
    expectClean(sb, second);
    expect(second.stdout).toContain("up to date");
    expect(second.out).not.toContain("moved");
    expect(sb.read(".repo/subagents/release-notes.md")).toBe(agent);
    expect(sb.read(".repo/skills/deploy-notes/SKILL.md")).toBe(skill);
    expect((await sb.git("status", "--porcelain")).stdout).toBe("");
    expectClean(sb, await sb.run("bun", ["repo", "sync", "--check"]));
  });
});

describe("a two-package workspace", () => {
  it("gives each package an AGENTS.md holding its pathless rules, scoped rules, nested skills and a deps index, in sync", async () => {
    const sb = new Sandbox("packages");
    await sb.scaffold({ workspaces: ["packages/*"] });
    sb.write(
      "packages/api/package.json",
      `${JSON.stringify({ name: "@acme/api", private: true, sideEffects: false, main: "src/main.ts" })}\n`,
    );
    sb.write("packages/api/src/main.ts", "export const main = 1;\n");
    sb.write("packages/api/references/INDEX.md", "# Api\n");
    sb.write(
      "packages/web/package.json",
      `${JSON.stringify({ name: "@acme/web", private: true, sideEffects: false, dependencies: { "@acme/api": "workspace:*" } })}\n`,
    );
    sb.write("packages/web/references/INDEX.md", "# Web\n");
    sb.write("packages/web/src/api/a.ts", "export const a = 1;\n");
    sb.write(
      "packages/web/src/main.ts",
      'import { main as api } from "@acme/api";\nimport { a } from "./api/a.ts";\n\nexport const main = api + a;\n',
    );
    sb.write(
      "packages/web/.repo/rules/components.md",
      "---\ndescription: Components\n---\nComponents live in src/components and use the ui kit.\n",
    );
    sb.write("packages/web/.repo/rules/api.md", "---\ndescription: Api\npaths:\n  - src/api/**\n---\nApi rule.\n");
    sb.write("packages/web/.repo/skills/deploy/SKILL.md", "---\nname: deploy\ndescription: Ships web.\n---\nDeploy.\n");
    await sb.commit("workspace");
    expectClean(sb, await sb.launch(PACKAGE_NAME, "init"));

    const unhashed = (rel: string) => sb.read(rel).replace(/^<!-- repo:rules [\da-f]{8} -->/, "<!-- repo:rules -->");
    const pointer = "<!-- repo:rules -->\nStart at references/INDEX.md in this package.\n";
    expect(unhashed("packages/web/AGENTS.md")).toBe(
      `${pointer}\n## Rules by path\n- \`packages/web/src/api/**\`: read \`packages/web/.repo/rules/api.md\`\n<!-- /repo:rules -->\n\nComponents live in src/components and use the ui kit.\n`,
    );
    expect(unhashed("packages/api/AGENTS.md")).toBe(`${pointer}<!-- /repo:rules -->\n`);
    for (const gone of [
      "packages/web/CLAUDE.md",
      "packages/web/.repo/rules/components.md",
      ".claude/rules/packages/web/components.md",
    ]) {
      expect(sb.exists(gone), gone).toBe(false);
    }
    expect(linkText(path.join(sb.repo, "packages/web/.claude/skills/deploy"))).toBe("../../.repo/skills/deploy");
    expect(sb.read("AGENTS.md")).not.toContain("Components live");
    const deps = /<!-- repo:deps [\da-f]{8} -->\n([\s\S]*?)<!-- \/repo:deps -->/.exec(
      sb.read("packages/web/references/INDEX.md"),
    )?.[1];
    expect(deps).toBe("- [@acme/api](../../api/references/INDEX.md)\n");

    await sb.commit("after init");
    expect(await ignoredFiles(sb)).toContain("packages/web/.claude/skills/deploy");
    const tracked = (await sb.git("ls-files")).stdout.split("\n");
    expect(tracked).toEqual(expect.arrayContaining(["packages/web/AGENTS.md", "packages/api/AGENTS.md"]));
    expect((await sb.git("status", "--porcelain")).stdout).toBe("");
    expectClean(sb, await sb.run("bun", ["repo", "sync", "--check"]));
    expectClean(sb, await sb.run("bun", ["repo", "check"]));
    const webManifest = sb.read("packages/web/package.json");
    sb.write("packages/web/package.json", webManifest.replace('"private":true,', ""));
    const missing = await sb.run("bun", ["repo", "check"]);
    expect(missing.status, tail(missing.out)).toBe(1);
    expect(missing.stderr).toContain(
      'repo check: packages/web/package.json: "private" is missing; set true, or false to publish it',
    );
    sb.write("packages/web/package.json", webManifest);

    // Scopes are the package names' last segments; a commit under any other is refused.
    sb.write("packages/web/src/api/a.test.ts", "export {};\n");
    await sb.git("add", "packages/web/src/api/a.test.ts");
    const scoped = await sb.run("git", ["commit", "-q", "-m", "feat(app): add a test"]);
    expect(scoped.status, tail(scoped.out)).toBe(1);
    expect(scoped.stderr).toContain(
      '  - unknown scope "app"; use a workspace package name or one of repo, deps, ci (api, web)\n',
    );
    expect(sb.expectOk(await sb.run("git", ["commit", "-q", "-m", "feat(web): add a test"])).status).toBe(0);
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
    expect(sb.exists(".repo/rules/agents.md")).toBe(false);
    expect(sb.json(".claude/settings.json", isClaudeSettings).permissions.allow).toContain("Bash(make test)");
    expect((await sb.git("ls-files")).stdout.split("\n")).toContain("AGENTS.md");
  });
});
