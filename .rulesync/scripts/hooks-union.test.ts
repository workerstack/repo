import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  AUTORUN_NEEDLES,
  GRUNT_NEEDLES,
  MAP,
  POST_WRITE_MATCHER,
  applyUnion,
  checkUnion,
  parseArgv,
  rootCmd,
} from "./hooks-union.mjs";
import { stripJsonc } from "./jsonc.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");
const script = path.join(here, "hooks-union.mjs");

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

const SCRUB = "scrub-spawn-prompt.mjs";
const GATE = "gate-fat-tools.mjs";
const PARENT = "orchestrate-parent.js";
const MCP_DENY = "mcp__*";
const EDIT_PLATFORM = "Edit(platform/**)";
const WRITE_PLATFORM = "Write(platform/**)";

const gruntPre = [
  {
    matcher: "spawn_subagent|Task|Agent|spawn_agent",
    hooks: [
      {
        type: "command",
        command: rootCmd(`.rulesync/scripts/${SCRUB}`),
        timeout: 5,
      },
    ],
  },
  {
    matcher: "Read|read_file|Grep|grep|Glob|list_dir|Bash|run_terminal_command|Write|Edit|write|search_replace",
    hooks: [
      {
        type: "command",
        command: rootCmd(`.rulesync/scripts/${GATE}`),
        timeout: 5,
      },
    ],
  },
];

const parentHook = {
  hooks: [
    {
      type: "command",
      command: rootCmd(`.grok/hooks/${PARENT}`),
      timeout: 5,
    },
  ],
};

function writeJson(ws: string, rel: string, obj: unknown) {
  const abs = path.join(ws, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, `${JSON.stringify(obj, null, 2)}\n`);
}

function readJson(ws: string, rel: string) {
  return JSON.parse(fs.readFileSync(path.join(ws, rel), "utf8"));
}

function seedGruntDrivers(ws: string) {
  writeJson(ws, ".claude/settings.json", {
    permissions: {
      deny: ["Agent(Explore)", "Agent(Plan)", MCP_DENY],
    },
    hooks: {
      PreToolUse: gruntPre,
      UserPromptSubmit: [parentHook],
      Stop: [{ ...parentHook, hooks: [{ ...parentHook.hooks[0], timeout: 30 }] }],
      SubagentStop: [{ ...parentHook, hooks: [{ ...parentHook.hooks[0], timeout: 30 }] }],
    },
    enableAllProjectMcpServers: false,
    enabledMcpjsonServers: [],
  });
  writeJson(ws, ".codex/hooks.json", {
    hooks: {
      PreToolUse: gruntPre,
      UserPromptSubmit: [parentHook],
      Stop: [{ ...parentHook, hooks: [{ ...parentHook.hooks[0], timeout: 30 }] }],
      SubagentStop: [{ ...parentHook, hooks: [{ ...parentHook.hooks[0], timeout: 30 }] }],
    },
  });
  writeJson(ws, ".agents/hooks.json", {
    rulesync: {
      PreToolUse: gruntPre,
      Stop: [{ ...parentHook, hooks: [{ ...parentHook.hooks[0], timeout: 30 }] }],
    },
  });
  writeJson(ws, ".gemini/settings.json", { mcpServers: {} });
  writeJson(ws, ".rulesync/hooks.jsonc", {
    version: 1,
    hooks: {
      preToolUse: [
        {
          matcher: "spawn_subagent|Task|Agent|spawn_agent",
          type: "command",
          command: rootCmd(`.rulesync/scripts/${SCRUB}`),
          timeout: 5,
        },
      ],
      beforeSubmitPrompt: [
        {
          type: "command",
          command: rootCmd(`.grok/hooks/${PARENT}`),
          timeout: 5,
        },
      ],
      stop: [
        {
          type: "command",
          command: rootCmd(`.grok/hooks/${PARENT}`),
          timeout: 30,
        },
      ],
    },
  });
  writeJson(ws, ".grok/hooks/orchestrate-parent.json", {
    hooks: {
      PreToolUse: [{ hooks: [{ type: "command", command: "node parent", timeout: 5 }] }],
      UserPromptSubmit: [{ hooks: [{ type: "command", command: "node parent", timeout: 5 }] }],
    },
  });
}

function touchConsumerScripts(ws: string) {
  fs.mkdirSync(path.join(ws, "scripts"), { recursive: true });
  for (const n of AUTORUN_NEEDLES) {
    fs.writeFileSync(path.join(ws, "scripts", n), "");
  }
}

describe("parseArgv", () => {
  it("defaults and --check", () => {
    expect(parseArgv([])).toEqual({ ok: true, check: false });
    expect(parseArgv(["--check"])).toEqual({ ok: true, check: true });
    expect(parseArgv(["--wat"]).ok).toBe(false);
  });
});

describe("grunt keep-list (no consumer overlay)", () => {
  it("re-applies scrub/gate after generate wipe; keeps UPS/Stop/mcp deny", () => {
    const ws = tmpDir("union-grunt-");
    seedGruntDrivers(ws);
    const claudePath = path.join(ws, ".claude/settings.json");
    const claude = readJson(ws, ".claude/settings.json");
    claude.hooks = {
      UserPromptSubmit: claude.hooks.UserPromptSubmit,
      Stop: claude.hooks.Stop,
    };
    fs.writeFileSync(claudePath, `${JSON.stringify(claude, null, 2)}\n`);
    const r = applyUnion({ workspaceRoot: ws });
    expect(r.ok).toBe(true);
    const next = readJson(ws, ".claude/settings.json");
    const text = JSON.stringify(next);
    for (const n of GRUNT_NEEDLES) expect(text).toContain(n);
    expect(JSON.stringify(next.hooks.UserPromptSubmit)).toMatch(PARENT);
    expect(JSON.stringify(next.hooks.Stop)).toMatch(PARENT);
    expect(next.permissions.deny).toContain(MCP_DENY);
    expect(next.permissions.deny).not.toContain(EDIT_PLATFORM);
    expect(next.permissions.deny).not.toContain(WRITE_PLATFORM);
    expect(next.hooks.SessionStart).toBeUndefined();
    expect(checkUnion({ workspaceRoot: ws })).toEqual([]);
  });

  it("does not rewrite SoT beforeSubmitPrompt or grok SessionStart", () => {
    const ws = tmpDir("union-sot-");
    seedGruntDrivers(ws);
    applyUnion({ workspaceRoot: ws });
    const ssot = fs.readFileSync(path.join(ws, ".rulesync/hooks.jsonc"), "utf8");
    expect(ssot).toMatch(/"beforeSubmitPrompt"/);
    expect(ssot).not.toMatch(/"userPromptSubmit"/);
    expect(ssot).not.toMatch(/daily-pull-check/);
    const grok = readJson(ws, ".grok/hooks/orchestrate-parent.json");
    expect(grok.hooks.SessionStart).toBeUndefined();
    const claude = readJson(ws, ".claude/settings.json");
    expect(claude.hooks.UserPromptSubmit).toBeDefined();
    expect(claude.hooks.beforeSubmitPrompt).toBeUndefined();
  });

  it("--check fails when grunt needles missing; writes nothing", () => {
    const ws = tmpDir("union-check-");
    seedGruntDrivers(ws);
    const claudePath = path.join(ws, ".claude/settings.json");
    const before = fs.readFileSync(claudePath, "utf8");
    const claude = JSON.parse(before);
    claude.hooks.PreToolUse = [];
    fs.writeFileSync(claudePath, `${JSON.stringify(claude, null, 2)}\n`);
    const failures = checkUnion({ workspaceRoot: ws });
    expect(failures.some((f: string) => f.includes(SCRUB))).toBe(true);
    expect(applyUnion({ workspaceRoot: ws, check: true }).ok).toBe(false);
    expect(fs.readFileSync(claudePath, "utf8")).toContain('"PreToolUse": []');
  });

  it("platform/ dir without permissions.json emits no path deny", () => {
    const ws = tmpDir("union-plat-");
    seedGruntDrivers(ws);
    fs.mkdirSync(path.join(ws, "platform"), { recursive: true });
    const claude = readJson(ws, ".claude/settings.json");
    claude.permissions.deny = [...claude.permissions.deny, WRITE_PLATFORM];
    writeJson(ws, ".claude/settings.json", claude);
    expect(applyUnion({ workspaceRoot: ws }).ok).toBe(true);
    const deny = readJson(ws, ".claude/settings.json").permissions.deny;
    expect(deny).toContain(MCP_DENY);
    expect(deny).not.toContain(EDIT_PLATFORM);
    expect(deny).not.toContain(WRITE_PLATFORM);
    expect(deny.some((x: string) => String(x).startsWith("Write("))).toBe(false);
    expect(checkUnion({ workspaceRoot: ws })).toEqual([]);
  });
});

describe("session folder map", () => {
  it("adds session-map SessionStart first on claude/codex (not agents/grok) and checks for it", () => {
    const ws = tmpDir("union-map-");
    seedGruntDrivers(ws);
    touchConsumerScripts(ws);
    fs.mkdirSync(path.join(ws, ".rulesync", "scripts"), { recursive: true });
    fs.writeFileSync(path.join(ws, ".rulesync", "scripts", "session-map.mjs"), "");
    expect(applyUnion({ workspaceRoot: ws }).ok).toBe(true);
    const claude = readJson(ws, ".claude/settings.json");
    expect(claude.hooks.SessionStart[0].hooks[0]).toEqual({ type: "command", command: MAP, timeout: 5 });
    expect(JSON.stringify(claude.hooks.SessionStart)).toMatch(/daily-pull-check/);
    expect(JSON.stringify(readJson(ws, ".codex/hooks.json"))).toContain("session-map.mjs");
    const agents = readJson(ws, ".agents/hooks.json");
    expect(JSON.stringify(agents)).not.toContain("session-map.mjs");
    expect(JSON.stringify(agents.rulesync.SessionStart)).toMatch(/daily-pull-check/);
    expect(readJson(ws, ".grok/hooks/orchestrate-parent.json").hooks.SessionStart).toBeUndefined();
    expect(checkUnion({ workspaceRoot: ws })).toEqual([]);

    claude.hooks.SessionStart = [];
    writeJson(ws, ".claude/settings.json", claude);
    expect(checkUnion({ workspaceRoot: ws })).toContain("claude: missing session-map.mjs");
  });
});

describe("consumer overlay keep-list re-apply", () => {
  it("puts SessionStart / check-behind / validate+sim / overlay Edit deny back with grunt scrub/gate", () => {
    const ws = tmpDir("union-consumer-");
    seedGruntDrivers(ws);
    touchConsumerScripts(ws);
    writeJson(ws, ".rulesync/permissions.json", { deny: [EDIT_PLATFORM] });
    const claude = readJson(ws, ".claude/settings.json");
    claude.hooks = { UserPromptSubmit: claude.hooks.UserPromptSubmit };
    claude.permissions.deny = [...claude.permissions.deny, WRITE_PLATFORM];
    writeJson(ws, ".claude/settings.json", claude);
    writeJson(ws, ".codex/hooks.json", { hooks: {} });
    writeJson(ws, ".agents/hooks.json", { rulesync: {} });
    writeJson(ws, ".gemini/settings.json", { mcpServers: {}, extra: true });

    expect(applyUnion({ workspaceRoot: ws }).ok).toBe(true);
    expect(checkUnion({ workspaceRoot: ws })).toEqual([]);

    const next = readJson(ws, ".claude/settings.json");
    const text = JSON.stringify(next);
    for (const n of [...AUTORUN_NEEDLES, ...GRUNT_NEEDLES]) {
      expect(text).toContain(n);
    }
    expect(JSON.stringify(next.hooks.UserPromptSubmit)).toMatch(PARENT);
    expect(next.permissions.deny).toContain(MCP_DENY);
    expect(next.permissions.deny).toContain(EDIT_PLATFORM);
    expect(next.permissions.deny).not.toContain(WRITE_PLATFORM);
    expect(next.permissions.deny.some((x: string) => String(x).startsWith("Write("))).toBe(
      false,
    );
    expect(next.hooks.SessionStart).toBeTruthy();
    expect(JSON.stringify(next.hooks.PreToolUse)).toMatch(/check-behind/);
    expect(JSON.stringify(next.hooks.PostToolUse)).toMatch(/validate\.mjs/);
    expect(JSON.stringify(next.hooks.PostToolUse)).toMatch(/sim\.mjs/);
    expect(next.hooks.PostToolUse[0].matcher).toBe(POST_WRITE_MATCHER);
    expect(JSON.stringify(next.hooks.PostToolUse)).not.toContain('"matcher": ".*"');

    const agents = readJson(ws, ".agents/hooks.json");
    expect(agents["validate-artifact"].matcher).toBe(POST_WRITE_MATCHER);
    expect(agents["simulate-artifact"].matcher).toBe(POST_WRITE_MATCHER);
    expect(agents.rulesync.PostToolUse[0].matcher).toBe(POST_WRITE_MATCHER);
    expect(JSON.stringify(agents.rulesync.PostToolUse)).not.toContain('"matcher": ".*"');
    expect(JSON.stringify(agents["validate-artifact"])).not.toContain('"matcher": ".*"');
    expect(JSON.stringify(agents["simulate-artifact"])).not.toContain('"matcher": ".*"');
    expect(JSON.stringify(agents.rulesync.Stop ?? agents.rulesync.stop)).toBeUndefined();
    expect(JSON.stringify(agents.rulesync.PreToolUse)).toMatch(SCRUB);

    const gemini = readJson(ws, ".gemini/settings.json");
    expect(gemini.extra).toBe(true);
    expect(JSON.stringify(gemini.hooks)).toMatch(/daily-pull-check/);
    expect(JSON.stringify(gemini.hooks)).not.toMatch(/check-behind/);
    expect(gemini._caveat_check_behind).toBeTruthy();
    expect(gemini._caveat_permissions).toBeTruthy();
    expect(String(gemini._caveat_permissions)).not.toMatch(/platform/);
    expect(String(gemini._caveat_permissions)).not.toMatch(/Write\(/);

    const ssot = fs.readFileSync(path.join(ws, ".rulesync/hooks.jsonc"), "utf8");
    expect(ssot).toMatch(/"beforeSubmitPrompt"/);
  });

  it("apply is idempotent on keep-list", () => {
    const ws = tmpDir("union-idemp-");
    seedGruntDrivers(ws);
    touchConsumerScripts(ws);
    writeJson(ws, ".rulesync/permissions.json", { deny: [EDIT_PLATFORM] });
    applyUnion({ workspaceRoot: ws });
    const first = fs.readFileSync(path.join(ws, ".claude/settings.json"), "utf8");
    applyUnion({ workspaceRoot: ws });
    const second = fs.readFileSync(path.join(ws, ".claude/settings.json"), "utf8");
    expect(second).toBe(first);
    const deny = readJson(ws, ".claude/settings.json").permissions.deny;
    expect(deny.filter((x: string) => x === MCP_DENY)).toEqual([MCP_DENY]);
    expect(deny.filter((x: string) => x === EDIT_PLATFORM)).toEqual([EDIT_PLATFORM]);
  });
});

describe("repo SSOT + CLI", () => {
  it("package SoT is beforeSubmitPrompt; Claude/Codex native UserPromptSubmit; check ok", () => {
    const ssot = fs.readFileSync(path.join(repoRoot, ".rulesync/hooks.jsonc"), "utf8");
    expect(ssot).toMatch(/"beforeSubmitPrompt"/);
    expect(ssot).not.toMatch(/"userPromptSubmit"/);
    const claude = JSON.parse(
      fs.readFileSync(path.join(repoRoot, ".claude/settings.json"), "utf8"),
    );
    expect(claude.hooks.UserPromptSubmit).toBeDefined();
    expect(claude.hooks.beforeSubmitPrompt).toBeUndefined();
    expect(claude.permissions.deny).toContain(MCP_DENY);
    const codex = JSON.parse(fs.readFileSync(path.join(repoRoot, ".codex/hooks.json"), "utf8"));
    expect(codex.hooks.UserPromptSubmit).toBeDefined();
    expect(checkUnion({ workspaceRoot: repoRoot })).toEqual([]);
  });

  it("hooks-union --check is the keep-list entry point", () => {
    const r = spawnSync(process.execPath, [script, "--check"], {
      cwd: repoRoot,
      encoding: "utf8",
      timeout: 20_000,
    });
    expect(r.status).toBe(0, r.stderr || r.stdout);
    expect(r.stdout).toMatch(/check ok/);
  });
});

describe("hook commands from any start", () => {
  const PROJECT_VARS = ["GROK_WORKSPACE_ROOT", "CLAUDE_PROJECT_DIR", "GEMINI_PROJECT_DIR"];
  const STUBS = [
    `.rulesync/scripts/${SCRUB}`,
    `.rulesync/scripts/${GATE}`,
    ".rulesync/scripts/session-map.mjs",
    `.grok/hooks/${PARENT}`,
    ".grok/hooks/rtk-grok.js",
    ...AUTORUN_NEEDLES.map((n) => `scripts/${n}`),
  ];
  const EVENTS: Record<string, string> = {
    preToolUse: "PreToolUse",
    sessionStart: "SessionStart",
    beforeSubmitPrompt: "UserPromptSubmit",
    stop: "Stop",
    subagentStop: "SubagentStop",
  };

  function gitRepo(prefix: string) {
    const root = fs.realpathSync(tmpDir(prefix));
    spawnSync("git", ["init", "-q"], { cwd: root });
    return root;
  }

  /** A stub that records its root-relative path in `<root>/ran.txt` when run. */
  function writeStub(root: string, rel: string, ran = path.join(root, "ran.txt")) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    const fsImport = rel.endsWith(".mjs") ? 'import fs from "node:fs";' : 'const fs = require("node:fs");';
    fs.writeFileSync(abs, `${fsImport}\nfs.appendFileSync(${JSON.stringify(ran)}, ${JSON.stringify(`${rel}\n`)});\n`);
  }

  function run(command: string, cwd: string, extra: Record<string, string> = {}) {
    const env: Record<string, string | undefined> = { ...process.env, ...extra };
    for (const k of PROJECT_VARS) if (!(k in extra)) delete env[k];
    return spawnSync("bash", ["-c", command], { cwd, env, input: "{}", encoding: "utf8", timeout: 20_000 });
  }

  function commandsIn(value: unknown, out: string[] = []): string[] {
    if (Array.isArray(value)) for (const v of value) commandsIn(v, out);
    else if (value && typeof value === "object") {
      for (const [k, v] of Object.entries(value)) {
        if (k === "command" && typeof v === "string") out.push(v);
        else commandsIn(v, out);
      }
    }
    return out;
  }

  /** The repo's shipped hook sources, plus generated configs shaped like rulesync output of `hooks.jsonc`. */
  function seedShipped(root: string) {
    const ssot = fs.readFileSync(path.join(repoRoot, ".rulesync/hooks.jsonc"), "utf8");
    fs.mkdirSync(path.join(root, ".rulesync"), { recursive: true });
    fs.writeFileSync(path.join(root, ".rulesync/hooks.jsonc"), ssot);
    for (const f of fs.readdirSync(path.join(repoRoot, ".grok/hooks")).filter((n) => n.endsWith(".json") && n !== "package.json")) {
      writeJson(root, `.grok/hooks/${f}`, readJson(repoRoot, `.grok/hooks/${f}`));
    }
    const hooks: Record<string, unknown[]> = {};
    for (const [event, entries] of Object.entries(JSON.parse(stripJsonc(ssot)).hooks)) {
      hooks[EVENTS[event]] = (entries as { matcher?: string; command: string; timeout?: number }[]).map((e) => ({
        ...(e.matcher ? { matcher: e.matcher } : {}),
        hooks: [{ type: "command", command: e.command, timeout: e.timeout }],
      }));
    }
    writeJson(root, ".claude/settings.json", { permissions: { deny: [] }, hooks });
    writeJson(root, ".codex/hooks.json", { hooks });
    writeJson(root, ".agents/hooks.json", { rulesync: { PreToolUse: hooks.PreToolUse, Stop: hooks.Stop } });
    writeJson(root, ".gemini/settings.json", { mcpServers: {} });
  }

  const shippedFiles = (root: string) => [
    ".claude/settings.json",
    ".codex/hooks.json",
    ".agents/hooks.json",
    ".gemini/settings.json",
    ...fs.readdirSync(path.join(root, ".grok/hooks")).filter((n) => n.endsWith(".json")).map((n) => `.grok/hooks/${n}`),
  ];

  it("every shipped and generated command runs its root script from a subdir", () => {
    const root = gitRepo("union-anystart-");
    fs.mkdirSync(path.join(root, "packages/a"), { recursive: true });
    for (const rel of STUBS) writeStub(root, rel);
    seedShipped(root);
    expect(applyUnion({ workspaceRoot: root }).ok).toBe(true);
    const commands = new Set([
      ...shippedFiles(root).flatMap((f) => commandsIn(readJson(root, f))),
      ...commandsIn(JSON.parse(stripJsonc(fs.readFileSync(path.join(root, ".rulesync/hooks.jsonc"), "utf8")))),
    ]);
    for (const extra of [{}, { CLAUDE_PROJECT_DIR: path.join(root, "packages/a") }, { CLAUDE_PROJECT_DIR: root }]) {
      fs.rmSync(path.join(root, "ran.txt"), { force: true });
      for (const c of commands) {
        const r = run(c, path.join(root, "packages/a"), extra);
        expect(r.status, `${JSON.stringify(extra)} ${c}\n${r.stderr}`).toBe(0);
      }
      const ran = new Set(fs.readFileSync(path.join(root, "ran.txt"), "utf8").split("\n").filter(Boolean));
      expect([...ran].sort()).toEqual([...STUBS].sort());
    }
  }, 30_000);

  it("keeps a grunt install in a subpackage on its own scripts", () => {
    const root = gitRepo("union-subpkg-");
    const web = path.join(root, "apps/web");
    fs.mkdirSync(path.join(web, "src"), { recursive: true });
    writeStub(web, `.rulesync/scripts/${GATE}`, path.join(root, "ran.txt"));
    const r = run(rootCmd(`.rulesync/scripts/${GATE}`), path.join(web, "src"), { CLAUDE_PROJECT_DIR: web });
    expect(r.status, r.stderr).toBe(0);
    expect(fs.readFileSync(path.join(root, "ran.txt"), "utf8")).toBe(`.rulesync/scripts/${GATE}\n`);
  });

  it("runs from the hook cwd outside a git repo", () => {
    const dir = fs.realpathSync(tmpDir("union-nogit-"));
    writeStub(dir, "x.mjs");
    const r = run(rootCmd("x.mjs"), dir);
    expect(r.status, r.stderr).toBe(0);
    expect(fs.readFileSync(path.join(dir, "ran.txt"), "utf8")).toBe("x.mjs\n");
  });

  it("--check names each command that does not find its script from the repo root", () => {
    const ws = tmpDir("union-stale-");
    seedGruntDrivers(ws);
    seedShipped(ws);
    touchConsumerScripts(ws);
    expect(applyUnion({ workspaceRoot: ws }).ok).toBe(true);
    const claude = readJson(ws, ".claude/settings.json");
    claude.hooks.PostToolUse.push(
      { matcher: "Write", hooks: [{ type: "command", command: "node scripts/validate.mjs --hook" }] },
      { matcher: "Write", hooks: [{ type: "command", command: "node scripts/my-custom-hook.mjs" }] },
    );
    writeJson(ws, ".claude/settings.json", claude);
    writeJson(ws, ".grok/hooks/rtk.json", {
      hooks: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: 'node "$GROK_WORKSPACE_ROOT/.grok/hooks/rtk-grok.js"' }] }] },
    });
    const failures = checkUnion({ workspaceRoot: ws });
    expect(failures).toContain("claude: validate.mjs hook command does not find its script from the repo root: run grunt upgrade");
    expect(failures).toContain("grok: rtk-grok.js hook command does not find its script from the repo root: run grunt upgrade");
    expect(failures.filter((f) => f.includes("my-custom-hook"))).toEqual([]);
  });
});
