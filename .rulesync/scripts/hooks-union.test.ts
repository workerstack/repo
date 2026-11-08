import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  AGY_WRITE_MATCHER,
  BEHIND,
  AUTORUN_NEEDLES,
  CURSOR_WRITE_MATCHER,
  OWNED_HOOKS,
  MAP,
  POST_WRITE_MATCHER,
  applyUnion,
  checkUnion,
  parseArgv,
  rootCmd,
} from "./hooks-union.ts";
import { TOOLS, eventKey } from "./gate-fat-tools.ts";
import { HOOK_NAMES, hookCommand } from "./hook-command.ts";
import { stripJsonc } from "./jsonc.ts";
import { BUN } from "../../dev/test-paths";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");
const script = path.join(here, "hooks-union.ts");

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

const SCRUB = "scrub-spawn-prompt";
describe("rootCmd", () => {
  it("runs the script with bun from the resolved project dir", () => {
    expect(rootCmd("a/x.mjs")).toMatch(/; bun "\$d\/a\/x\.mjs"$/);
    expect(rootCmd("a/x.mjs", "--hook")).toMatch(/; bun "\$d\/a\/x\.mjs" --hook$/);
  });
});

describe("script commands by extension", () => {
  const staleBehind = [
    'bun "C:\\r\\scripts\\check-behind.mjs" --hook',
    "bun /r/scripts/check-behind.mjs --old",
  ];

  it("replaces a consumer hook by its script name under / or \\ separators and keeps other .ts/.mjs/.js extras", () => {
    for (const command of staleBehind) {
      const ws = tmpDir("union-ext-");
      seedOwnedDrivers(ws);
      touchConsumerScripts(ws);
      const claude = readJson<ClaudeDoc>(ws, ".claude/settings.json");
      claude.hooks.PreToolUse.push(
        { matcher: "Write|Edit", hooks: [{ type: "command", command }] },
        { matcher: "Bash", hooks: [{ type: "command", command: "bun scripts/mine.ts" }] },
        { matcher: "Bash", hooks: [{ type: "command", command: "bun scripts/mine.mjs" }] },
        { matcher: "Bash", hooks: [{ type: "command", command: "bun scripts/mine.js" }] },
      );
      writeJson(ws, ".claude/settings.json", claude);
      expect(applyUnion({ workspaceRoot: ws }).ok).toBe(true);
      const commands = readJson<ClaudeDoc>(ws, ".claude/settings.json").hooks.PreToolUse.flatMap((g: { hooks: { command: string }[] }) =>
        g.hooks.map((h) => h.command),
      );
      expect(commands.filter((c: string) => c.includes("check-behind"))).toEqual([BEHIND]);
      for (const kept of ["mine.ts", "mine.mjs", "mine.js"]) expect(commands).toContain(`bun scripts/${kept}`);
    }
  });

  it("--check accepts hookCommand for a repo hook and rejects every other form", () => {
    const check = (command: string) => {
      const ws = tmpDir("union-form-");
      writeJson(ws, ".grok/hooks/rtk.json", { hooks: { PreToolUse: [{ hooks: [{ type: "command", command }] }] } });
      return checkUnion({ workspaceRoot: ws }).filter((f) => f.includes("rtk-grok"));
    };
    expect(check(hookCommand("rtk-grok"))).toEqual([]);
    for (const bad of [
      rootCmd(".grok/hooks/rtk-grok.ts"),
      'bun "$GROK_WORKSPACE_ROOT/.grok/hooks/rtk-grok.ts"',
      "bun .grok/hooks/rtk-grok.ts",
      'bun ".grok\\hooks\\rtk-grok.ts"',
      "repo hook rtk-grok",
      hookCommand("rtk-grok").replace('"$r" hook', "bun repo hook"),
    ]) {
      expect(check(bad), bad).toEqual([
        'grok: rtk-grok hook command does not run "$d/node_modules/.bin/repo" hook rtk-grok: run repo upgrade',
      ]);
    }
  });

  it("--check accepts rootCmd for a consumer script and rejects every other form", () => {
    const check = (command: string) => {
      const ws = tmpDir("union-form-");
      writeJson(ws, ".grok/hooks/rtk.json", { hooks: { PreToolUse: [{ hooks: [{ type: "command", command }] }] } });
      return checkUnion({ workspaceRoot: ws }).filter((f) => f.includes("validate.mjs"));
    };
    expect(check(rootCmd("scripts/validate.mjs", "--hook"))).toEqual([]);
    expect(check("bun scripts/validate.mjs --hook")).toHaveLength(1);
  });
});

const GATE = "gate-fat-tools";
const PARENT = "orchestrate-parent";
const MCP_DENY = "mcp__*";
const EDIT_PLATFORM = "Edit(platform/**)";
const WRITE_PLATFORM = "Write(platform/**)";

const ownedPre = [
  {
    matcher: "spawn_subagent|Task|Agent|spawn_agent",
    hooks: [
      {
        type: "command",
        command: hookCommand(SCRUB),
        timeout: 5,
      },
    ],
  },
  {
    matcher: "Read|read_file|Grep|grep|Glob|list_dir|Bash|run_terminal_command|Write|Edit|write|search_replace",
    hooks: [
      {
        type: "command",
        command: hookCommand(GATE),
        timeout: 5,
      },
    ],
  },
];

const parentHook = {
  hooks: [
    {
      type: "command",
      command: hookCommand(PARENT),
      timeout: 5,
    },
  ],
};

function writeJson(ws: string, rel: string, obj: unknown) {
  const abs = path.join(ws, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, `${JSON.stringify(obj, null, 2)}\n`);
}

interface HookCommand {
  type?: string;
  command: string;
  timeout?: number;
}
interface HookGroup {
  matcher?: string;
  hooks: HookCommand[];
}
/** A flat entry (Cursor, Antigravity SessionStart): the hook fields at the top, no `hooks` array. */
interface FlatEntry {
  type: string;
  command: string;
  timeout?: number;
  matcher?: string;
  hooks?: undefined;
}
interface ClaudeDoc {
  permissions: { deny: string[] };
  hooks: {
    PreToolUse: HookGroup[];
    PostToolUse: HookGroup[];
    UserPromptSubmit: HookGroup[];
    Stop: HookGroup[];
    SessionStart?: HookGroup[];
    beforeSubmitPrompt?: HookGroup[];
    WorktreeCreate?: HookGroup[];
    WorktreeRemove?: HookGroup[];
  };
}
interface AgentsDoc {
  rulesync: {
    PreToolUse: HookGroup[];
    PostToolUse: HookGroup[];
    Stop?: HookGroup[];
    stop?: HookGroup[];
    SessionStart: FlatEntry[];
  };
  "check-behind": HookGroup;
  "validate-artifact": HookGroup;
  "simulate-artifact": HookGroup;
}
interface CursorDoc {
  version: number;
  hooks: { sessionStart: FlatEntry[]; preToolUse: FlatEntry[]; postToolUse: FlatEntry[]; stop: unknown };
}
interface GrokDoc {
  hooks: { SessionStart?: unknown };
}
interface SsotFile {
  hooks: Record<string, { matcher?: string; command: string; timeout?: number }[]>;
  claudecode: { hooks: unknown };
}

/** Reads a JSON file the test just wrote or the repo ships; the caller names the shape it expects. */
function readJson<T = unknown>(ws: string, rel: string): T {
  return JSON.parse(fs.readFileSync(path.join(ws, rel), "utf8")) as T;
}

function ssotOf(text: string): SsotFile {
  return JSON.parse(stripJsonc(text)) as SsotFile;
}

function seedOwnedDrivers(ws: string) {
  writeJson(ws, ".claude/settings.json", {
    permissions: {
      deny: ["Agent(Explore)", "Agent(Plan)", MCP_DENY],
    },
    hooks: {
      PreToolUse: ownedPre,
      UserPromptSubmit: [parentHook],
      Stop: [{ ...parentHook, hooks: [{ ...parentHook.hooks[0], timeout: 30 }] }],
      SubagentStop: [{ ...parentHook, hooks: [{ ...parentHook.hooks[0], timeout: 30 }] }],
    },
    enableAllProjectMcpServers: false,
    enabledMcpjsonServers: [],
  });
  writeJson(ws, ".codex/hooks.json", {
    hooks: {
      PreToolUse: ownedPre,
      UserPromptSubmit: [parentHook],
      Stop: [{ ...parentHook, hooks: [{ ...parentHook.hooks[0], timeout: 30 }] }],
      SubagentStop: [{ ...parentHook, hooks: [{ ...parentHook.hooks[0], timeout: 30 }] }],
    },
  });
  writeJson(ws, ".agents/hooks.json", {
    rulesync: {
      PreToolUse: ownedPre,
      Stop: [{ ...parentHook, hooks: [{ ...parentHook.hooks[0], timeout: 30 }] }],
    },
  });
  writeJson(ws, ".cursor/hooks.json", {
    version: 1,
    hooks: {
      preToolUse: ownedPre.map((g) => ({ ...g.hooks[0], matcher: g.matcher })),
      beforeSubmitPrompt: [{ ...parentHook.hooks[0] }],
      stop: [{ ...parentHook.hooks[0], timeout: 30 }],
    },
  });
  writeJson(ws, ".rulesync/hooks.jsonc", {
    version: 1,
    hooks: {
      preToolUse: [
        {
          matcher: "spawn_subagent|Task|Agent|spawn_agent",
          type: "command",
          command: hookCommand(SCRUB),
          timeout: 5,
        },
      ],
      beforeSubmitPrompt: [
        {
          type: "command",
          command: hookCommand(PARENT),
          timeout: 5,
        },
      ],
      stop: [
        {
          type: "command",
          command: hookCommand(PARENT),
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

describe("repo keep-list (no consumer overlay)", () => {
  it("keeps rulesync's scrub/gate groups, UPS/Stop and the mcp deny", () => {
    const ws = tmpDir("union-repo-");
    seedOwnedDrivers(ws);
    const r = applyUnion({ workspaceRoot: ws });
    expect(r.ok).toBe(true);
    const next = readJson<ClaudeDoc>(ws, ".claude/settings.json");
    const text = JSON.stringify(next);
    for (const n of OWNED_HOOKS) expect(text).toContain(`hook ${n}`);
    expect(next.hooks.PreToolUse).toEqual(ownedPre);
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
    seedOwnedDrivers(ws);
    applyUnion({ workspaceRoot: ws });
    const ssot = fs.readFileSync(path.join(ws, ".rulesync/hooks.jsonc"), "utf8");
    expect(ssot).toMatch(/"beforeSubmitPrompt"/);
    expect(ssot).not.toMatch(/"userPromptSubmit"/);
    expect(ssot).not.toMatch(/daily-pull-check/);
    const grok = readJson<GrokDoc>(ws, ".grok/hooks/orchestrate-parent.json");
    expect(grok.hooks.SessionStart).toBeUndefined();
    const claude = readJson<ClaudeDoc>(ws, ".claude/settings.json");
    expect(claude.hooks.UserPromptSubmit).toBeDefined();
    expect(claude.hooks.beforeSubmitPrompt).toBeUndefined();
  });

  it("--check fails when repo needles missing; writes nothing", () => {
    const ws = tmpDir("union-check-");
    seedOwnedDrivers(ws);
    const claudePath = path.join(ws, ".claude/settings.json");
    const before = fs.readFileSync(claudePath, "utf8");
    const claude = JSON.parse(before) as ClaudeDoc;
    claude.hooks.PreToolUse = [];
    fs.writeFileSync(claudePath, `${JSON.stringify(claude, null, 2)}\n`);
    const failures = checkUnion({ workspaceRoot: ws });
    expect(failures.some((f: string) => f.includes(SCRUB))).toBe(true);
    expect(applyUnion({ workspaceRoot: ws, check: true }).ok).toBe(false);
    expect(fs.readFileSync(claudePath, "utf8")).toContain('"PreToolUse": []');
  });

  it("platform/ dir without permissions.json emits no path deny", () => {
    const ws = tmpDir("union-plat-");
    seedOwnedDrivers(ws);
    fs.mkdirSync(path.join(ws, "platform"), { recursive: true });
    const claude = readJson<ClaudeDoc>(ws, ".claude/settings.json");
    claude.permissions.deny = [...claude.permissions.deny, WRITE_PLATFORM];
    writeJson(ws, ".claude/settings.json", claude);
    expect(applyUnion({ workspaceRoot: ws }).ok).toBe(true);
    const deny = readJson<ClaudeDoc>(ws, ".claude/settings.json").permissions.deny;
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
    seedOwnedDrivers(ws);
    touchConsumerScripts(ws);
    fs.mkdirSync(path.join(ws, ".rulesync", "scripts"), { recursive: true });
    fs.writeFileSync(path.join(ws, ".rulesync", "scripts", "session-map.ts"), "");
    expect(applyUnion({ workspaceRoot: ws }).ok).toBe(true);
    const claude = readJson<ClaudeDoc>(ws, ".claude/settings.json");
    expect(claude.hooks.SessionStart![0]!.hooks[0]).toEqual({ type: "command", command: MAP, timeout: 5 });
    expect(JSON.stringify(claude.hooks.SessionStart)).toMatch(/daily-pull-check/);
    expect(JSON.stringify(readJson(ws, ".codex/hooks.json"))).toContain("hook session-map");
    const agents = readJson<AgentsDoc>(ws, ".agents/hooks.json");
    expect(JSON.stringify(agents)).not.toContain("session-map");
    expect(JSON.stringify(agents.rulesync.SessionStart)).toMatch(/daily-pull-check/);
    expect(readJson<GrokDoc>(ws, ".grok/hooks/orchestrate-parent.json").hooks.SessionStart).toBeUndefined();
    expect(checkUnion({ workspaceRoot: ws })).toEqual([]);

    claude.hooks.SessionStart = [];
    writeJson(ws, ".claude/settings.json", claude);
    expect(checkUnion({ workspaceRoot: ws })).toContain("claude: missing session-map");
  });

  it("replaces an old-form map with the one repo hook command, and stays put", () => {
    const ws = tmpDir("union-map-old-");
    seedOwnedDrivers(ws);
    fs.mkdirSync(path.join(ws, ".rulesync", "scripts"), { recursive: true });
    fs.writeFileSync(path.join(ws, ".rulesync", "scripts", "session-map.ts"), "");
    const claude = readJson<ClaudeDoc>(ws, ".claude/settings.json");
    claude.hooks.SessionStart = [{ hooks: [{ type: "command", command: rootCmd(".rulesync/scripts/session-map.ts"), timeout: 5 }] }];
    writeJson(ws, ".claude/settings.json", claude);
    expect(checkUnion({ workspaceRoot: ws })).toContain(
      'claude: session-map hook command does not run "$d/node_modules/.bin/repo" hook session-map: run repo upgrade',
    );
    expect(MAP).toBe(hookCommand("session-map"));
    applyUnion({ workspaceRoot: ws });
    const first = fs.readFileSync(path.join(ws, ".claude/settings.json"), "utf8");
    applyUnion({ workspaceRoot: ws });
    expect(fs.readFileSync(path.join(ws, ".claude/settings.json"), "utf8")).toBe(first);
    const session = readJson<ClaudeDoc>(ws, ".claude/settings.json").hooks.SessionStart!;
    expect(session.flatMap((g) => g.hooks.map((h) => h.command))).toEqual([MAP]);
    expect(checkUnion({ workspaceRoot: ws })).toEqual([]);
  });
});

describe("consumer overlay keep-list re-apply", () => {
  it("puts SessionStart / check-behind / validate+sim / overlay Edit deny back beside rulesync's scrub/gate", () => {
    const ws = tmpDir("union-consumer-");
    seedOwnedDrivers(ws);
    touchConsumerScripts(ws);
    writeJson(ws, ".rulesync/permissions.json", { deny: [EDIT_PLATFORM] });
    const claude = readJson<ClaudeDoc>(ws, ".claude/settings.json");
    claude.hooks = { PreToolUse: ownedPre, UserPromptSubmit: claude.hooks.UserPromptSubmit } as ClaudeDoc["hooks"];
    claude.permissions.deny = [...claude.permissions.deny, WRITE_PLATFORM];
    writeJson(ws, ".claude/settings.json", claude);
    writeJson(ws, ".codex/hooks.json", { hooks: { PreToolUse: ownedPre } });
    writeJson(ws, ".agents/hooks.json", { rulesync: { PreToolUse: ownedPre } });

    expect(applyUnion({ workspaceRoot: ws }).ok).toBe(true);
    expect(checkUnion({ workspaceRoot: ws })).toEqual([]);

    const next = readJson<ClaudeDoc>(ws, ".claude/settings.json");
    const text = JSON.stringify(next);
    for (const n of [...AUTORUN_NEEDLES, ...OWNED_HOOKS]) {
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
    expect(next.hooks.PostToolUse[0]!.matcher).toBe(POST_WRITE_MATCHER);
    expect(JSON.stringify(next.hooks.PostToolUse)).not.toContain('"matcher": ".*"');

    const agents = readJson<AgentsDoc>(ws, ".agents/hooks.json");
    expect(agents["validate-artifact"].matcher).toBe(AGY_WRITE_MATCHER);
    expect(agents["simulate-artifact"].matcher).toBe(AGY_WRITE_MATCHER);
    expect(agents.rulesync.PostToolUse[0]!.matcher).toBe(AGY_WRITE_MATCHER);
    expect(JSON.stringify(agents.rulesync.PostToolUse)).not.toContain('"matcher": ".*"');
    expect(JSON.stringify(agents["validate-artifact"])).not.toContain('"matcher": ".*"');
    expect(JSON.stringify(agents["simulate-artifact"])).not.toContain('"matcher": ".*"');
    expect(JSON.stringify(agents.rulesync.Stop ?? agents.rulesync.stop)).toBeUndefined();
    expect(JSON.stringify(agents.rulesync.PreToolUse)).toMatch(SCRUB);

    const ssot = fs.readFileSync(path.join(ws, ".rulesync/hooks.jsonc"), "utf8");
    expect(ssot).toMatch(/"beforeSubmitPrompt"/);
  });

  it("apply is idempotent on keep-list", () => {
    const ws = tmpDir("union-idemp-");
    seedOwnedDrivers(ws);
    touchConsumerScripts(ws);
    writeJson(ws, ".rulesync/permissions.json", { deny: [EDIT_PLATFORM] });
    applyUnion({ workspaceRoot: ws });
    const first = fs.readFileSync(path.join(ws, ".claude/settings.json"), "utf8");
    applyUnion({ workspaceRoot: ws });
    const second = fs.readFileSync(path.join(ws, ".claude/settings.json"), "utf8");
    expect(second).toBe(first);
    const deny = readJson<ClaudeDoc>(ws, ".claude/settings.json").permissions.deny;
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
    ) as ClaudeDoc;
    expect(claude.hooks.UserPromptSubmit).toBeDefined();
    expect(claude.hooks.beforeSubmitPrompt).toBeUndefined();
    expect(claude.permissions.deny).toContain(MCP_DENY);
    const codex = JSON.parse(fs.readFileSync(path.join(repoRoot, ".codex/hooks.json"), "utf8")) as { hooks: { UserPromptSubmit?: unknown } };
    expect(codex.hooks.UserPromptSubmit).toBeDefined();
    expect(checkUnion({ workspaceRoot: repoRoot })).toEqual([]);
  });

  it("hooks-union --check is the keep-list entry point", () => {
    const r = spawnSync(BUN, [script, "--check"], {
      cwd: repoRoot,
      encoding: "utf8",
      timeout: 20_000,
    });
    expect(r.status, r.stderr || r.stdout).toBe(0);
    expect(r.stdout).toMatch(/check ok/);
  });
});

describe("hook commands from any start", () => {
  const PROJECT_VARS = ["GROK_WORKSPACE_ROOT", "CLAUDE_PROJECT_DIR"];
  const OWNED_STUBS = [".rulesync/scripts/session-map.ts", ".rulesync/scripts/worktree.ts"];
  const STUBS = AUTORUN_NEEDLES.map((n) => `scripts/${n}`);
  const RAN = [...HOOK_NAMES.map((n) => `hook ${n}`), ...STUBS];
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

  /** A `node_modules/.bin/repo` stub that records its arguments in `ran`. */
  function writeBin(root: string, ran = path.join(root, "ran.txt")) {
    const bin = path.join(root, "node_modules", ".bin", "repo");
    fs.mkdirSync(path.dirname(bin), { recursive: true });
    fs.writeFileSync(bin, `#!/bin/sh\necho "$*" >> ${JSON.stringify(ran)}\n`, { mode: 0o755 });
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
    for (const [event, entries] of Object.entries(ssotOf(ssot).hooks)) {
      hooks[EVENTS[event]!] = entries.map((e) => ({
        ...(e.matcher ? { matcher: e.matcher } : {}),
        hooks: [{ type: "command", command: e.command, timeout: e.timeout }],
      }));
    }
    writeJson(root, ".claude/settings.json", { permissions: { deny: [] }, hooks });
    writeJson(root, ".codex/hooks.json", { hooks });
    writeJson(root, ".agents/hooks.json", { rulesync: { PreToolUse: hooks.PreToolUse, Stop: hooks.Stop } });
    writeJson(root, ".cursor/hooks.json", { version: 1, hooks: ssotOf(ssot).hooks });
  }

  const shippedFiles = (root: string) => [
    ".claude/settings.json",
    ".codex/hooks.json",
    ".agents/hooks.json",
    ".cursor/hooks.json",
    ...fs.readdirSync(path.join(root, ".grok/hooks")).filter((n) => n.endsWith(".json")).map((n) => `.grok/hooks/${n}`),
  ];

  it("every shipped and generated command runs its root bin or script from a subdir", () => {
    const root = gitRepo("union-anystart-");
    fs.mkdirSync(path.join(root, "packages/a"), { recursive: true });
    for (const rel of [...STUBS, ...OWNED_STUBS]) writeStub(root, rel);
    writeBin(root);
    seedShipped(root);
    expect(applyUnion({ workspaceRoot: root }).ok).toBe(true);
    const commands = new Set([
      ...shippedFiles(root).flatMap((f) => commandsIn(readJson(root, f))),
      ...commandsIn(JSON.parse(stripJsonc(fs.readFileSync(path.join(root, ".rulesync/hooks.jsonc"), "utf8")))),
    ]);
    for (const extra of [{}, { CLAUDE_PROJECT_DIR: path.join(root, "packages/a") }, { CLAUDE_PROJECT_DIR: root }] as Record<string, string>[]) {
      fs.rmSync(path.join(root, "ran.txt"), { force: true });
      for (const c of commands) {
        const r = run(c, path.join(root, "packages/a"), extra);
        expect(r.status, `${JSON.stringify(extra)} ${c}\n${r.stderr}`).toBe(0);
      }
      const ran = new Set(fs.readFileSync(path.join(root, "ran.txt"), "utf8").split("\n").filter(Boolean));
      expect([...ran].sort()).toEqual([...RAN].sort());
    }
  }, 30_000);

  it("keeps a repo install in a subpackage on its own bin", () => {
    const root = gitRepo("union-subpkg-");
    const web = path.join(root, "apps/web");
    fs.mkdirSync(path.join(web, "src"), { recursive: true });
    writeBin(root, path.join(root, "root-ran.txt"));
    writeBin(web, path.join(root, "ran.txt"));
    const r = run(hookCommand(GATE), path.join(web, "src"), { CLAUDE_PROJECT_DIR: web });
    expect(r.status, r.stderr).toBe(0);
    expect(fs.readFileSync(path.join(root, "ran.txt"), "utf8")).toBe(`hook ${GATE}\n`);
    expect(fs.existsSync(path.join(root, "root-ran.txt"))).toBe(false);
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
    seedOwnedDrivers(ws);
    seedShipped(ws);
    touchConsumerScripts(ws);
    expect(applyUnion({ workspaceRoot: ws }).ok).toBe(true);
    const claude = readJson<ClaudeDoc>(ws, ".claude/settings.json");
    claude.hooks.PostToolUse.push(
      { matcher: "Write", hooks: [{ type: "command", command: "node scripts/validate.mjs --hook" }] },
      { matcher: "Write", hooks: [{ type: "command", command: "node scripts/my-custom-hook.mjs" }] },
    );
    writeJson(ws, ".claude/settings.json", claude);
    writeJson(ws, ".grok/hooks/rtk.json", {
      hooks: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: 'bun "$GROK_WORKSPACE_ROOT/.grok/hooks/rtk-grok.ts"' }] }] },
    });
    const failures = checkUnion({ workspaceRoot: ws });
    expect(failures).toContain("claude: validate.mjs hook command does not find its script from the repo root: run repo upgrade");
    expect(failures).toContain('grok: rtk-grok hook command does not run "$d/node_modules/.bin/repo" hook rtk-grok: run repo upgrade');
    expect(failures.filter((f) => f.includes("my-custom-hook"))).toEqual([]);
  });
});

describe("rulesync-owned groups", () => {
  const AGY_SCRUB_GATE = [
    ownedPre[0],
    {
      ...ownedPre[1],
      matcher: "read_file|run_command|write_file|edit_file",
    },
  ];

  it("leaves the scrub and gate PreToolUse groups of every hook file byte-equal", () => {
    const ws = tmpDir("union-owned-");
    seedOwnedDrivers(ws);
    touchConsumerScripts(ws);
    writeJson(ws, ".agents/hooks.json", { rulesync: { PreToolUse: AGY_SCRUB_GATE } });
    expect(applyUnion({ workspaceRoot: ws }).ok).toBe(true);
    const groupsOf = (pre: { hooks: { command: string }[] }[]) =>
      pre.filter((g) => g.hooks.some((h) => OWNED_HOOKS.some((n) => h.command.includes(n))));
    expect(groupsOf(readJson<ClaudeDoc>(ws, ".claude/settings.json").hooks.PreToolUse)).toEqual(ownedPre);
    expect(groupsOf(readJson<ClaudeDoc>(ws, ".codex/hooks.json").hooks.PreToolUse)).toEqual(ownedPre);
    expect(groupsOf(readJson<AgentsDoc>(ws, ".agents/hooks.json").rulesync.PreToolUse)).toEqual(AGY_SCRUB_GATE);
  });

  it("writes no top-level scrub or gate entry into .agents/hooks.json", () => {
    const ws = tmpDir("union-named-");
    seedOwnedDrivers(ws);
    touchConsumerScripts(ws);
    expect(applyUnion({ workspaceRoot: ws }).ok).toBe(true);
    const keys = Object.keys(readJson<AgentsDoc>(ws, ".agents/hooks.json"));
    expect(keys).toEqual(expect.arrayContaining(["daily-pull-all", "check-behind", "validate-artifact"]));
    expect(keys).not.toContain("scrub-spawn-prompt");
    expect(keys).not.toContain("gate-fat-tools");
  });
});

describe("Antigravity consumer extras", () => {
  it("appends flat SessionStart entries after rulesync's, the session map first", () => {
    const ws = tmpDir("union-agy-session-");
    seedOwnedDrivers(ws);
    touchConsumerScripts(ws);
    const mapEntry = { type: "command", command: MAP, timeout: 5 };
    const agents = readJson<AgentsDoc>(ws, ".agents/hooks.json");
    agents.rulesync.SessionStart = [mapEntry];
    writeJson(ws, ".agents/hooks.json", agents);
    expect(applyUnion({ workspaceRoot: ws }).ok).toBe(true);
    const session = readJson<AgentsDoc>(ws, ".agents/hooks.json").rulesync.SessionStart;
    expect(session[0]).toEqual(mapEntry);
    expect(session.map((e: { command: string }) => AUTORUN_NEEDLES.find((n) => e.command.includes(n)))).toEqual([
      undefined,
      "daily-pull-check.mjs",
      "rtk-check.mjs",
      "daily-fleet-check.mjs",
    ]);
    for (const e of session) expect(Object.keys(e).sort()).toEqual(e.timeout ? ["command", "timeout", "type"] : ["command", "type"]);
    const first = fs.readFileSync(path.join(ws, ".agents/hooks.json"), "utf8");
    expect(applyUnion({ workspaceRoot: ws }).ok).toBe(true);
    expect(fs.readFileSync(path.join(ws, ".agents/hooks.json"), "utf8")).toBe(first);
  });

  it("writes SessionStart without a map entry when rulesync wrote none", () => {
    const ws = tmpDir("union-agy-nomap-");
    seedOwnedDrivers(ws);
    touchConsumerScripts(ws);
    expect(applyUnion({ workspaceRoot: ws }).ok).toBe(true);
    const session = readJson<AgentsDoc>(ws, ".agents/hooks.json").rulesync.SessionStart;
    expect(session).toHaveLength(3);
    expect(JSON.stringify(session)).not.toContain("session-map");
  });

  it("matches writes by Antigravity tool names, not Claude's", () => {
    const ws = tmpDir("union-agy-names-");
    seedOwnedDrivers(ws);
    touchConsumerScripts(ws);
    expect(applyUnion({ workspaceRoot: ws }).ok).toBe(true);
    const agents = readJson<AgentsDoc>(ws, ".agents/hooks.json");
    expect(AGY_WRITE_MATCHER).toBe("write_file|edit_file");
    const behind = agents.rulesync.PreToolUse.find((g: { hooks: { command: string }[] }) =>
      g.hooks.some((h) => h.command.includes("check-behind.mjs")),
    );
    expect(behind!.matcher).toBe(AGY_WRITE_MATCHER);
    expect(agents["check-behind"].matcher).toBe(AGY_WRITE_MATCHER);
    expect(agents.rulesync.PostToolUse[0]!.matcher).toBe(AGY_WRITE_MATCHER);
    for (const k of ["validate-artifact", "simulate-artifact"] as const) expect(agents[k].matcher).toBe(AGY_WRITE_MATCHER);
    const claudeBehind = readJson<ClaudeDoc>(ws, ".claude/settings.json").hooks.PreToolUse.find((g: { hooks: { command: string }[] }) =>
      g.hooks.some((h) => h.command.includes("check-behind.mjs")),
    );
    expect(claudeBehind!.matcher).toBe("Write|Edit");
  });
});

describe("Cursor consumer extras", () => {
  type Entry = FlatEntry;
  const cursorHooks = (ws: string) => readJson<CursorDoc>(ws, ".cursor/hooks.json");
  const scriptOf = (e: Entry) => AUTORUN_NEEDLES.find((n) => e.command.includes(n));

  it("appends flat entries under sessionStart, preToolUse and postToolUse, rulesync's kept as written", () => {
    const ws = tmpDir("union-cursor-");
    seedOwnedDrivers(ws);
    touchConsumerScripts(ws);
    const mapEntry = { type: "command", command: MAP, timeout: 5 };
    const seeded = cursorHooks(ws);
    seeded.hooks.sessionStart = [mapEntry];
    writeJson(ws, ".cursor/hooks.json", seeded);
    expect(applyUnion({ workspaceRoot: ws }).ok).toBe(true);
    const { version, hooks } = cursorHooks(ws);
    expect(version).toBe(1);
    expect(hooks.sessionStart[0]).toEqual(mapEntry);
    expect(hooks.sessionStart.map(scriptOf)).toEqual([undefined, "daily-pull-check.mjs", "rtk-check.mjs", "daily-fleet-check.mjs"]);
    const behind = hooks.preToolUse.filter((e: Entry) => e.command.includes("check-behind.mjs"));
    expect(behind).toEqual([{ type: "command", command: rootCmd("scripts/check-behind.mjs", "--hook"), matcher: CURSOR_WRITE_MATCHER }]);
    expect(hooks.postToolUse.map(scriptOf)).toEqual(["validate.mjs", "sim.mjs"]);
    expect(hooks.postToolUse.map((e: Entry) => e.matcher)).toEqual([CURSOR_WRITE_MATCHER, CURSOR_WRITE_MATCHER]);
    for (const e of [...hooks.sessionStart, ...hooks.preToolUse, ...hooks.postToolUse]) expect(e.hooks).toBeUndefined();
    expect(hooks.preToolUse.filter((e: Entry) => OWNED_HOOKS.some((n) => e.command.includes(n)))).toEqual(
      ownedPre.map((g) => ({ ...g.hooks[0], matcher: g.matcher })),
    );
    expect(hooks.stop).toEqual(seeded.hooks.stop);
    expect(checkUnion({ workspaceRoot: ws })).toEqual([]);
    const first = fs.readFileSync(path.join(ws, ".cursor/hooks.json"), "utf8");
    expect(applyUnion({ workspaceRoot: ws }).ok).toBe(true);
    expect(fs.readFileSync(path.join(ws, ".cursor/hooks.json"), "utf8")).toBe(first);
  });

  it("leaves a repo with no autorun scripts as rulesync wrote it", () => {
    const ws = tmpDir("union-cursor-plain-");
    seedOwnedDrivers(ws);
    const before = cursorHooks(ws);
    expect(applyUnion({ workspaceRoot: ws }).ok).toBe(true);
    expect(cursorHooks(ws)).toEqual(before);
    expect(checkUnion({ workspaceRoot: ws })).toEqual([]);
  });

  it("writes the file when rulesync wrote none", () => {
    const ws = tmpDir("union-cursor-new-");
    seedOwnedDrivers(ws);
    touchConsumerScripts(ws);
    fs.rmSync(path.join(ws, ".cursor"), { recursive: true });
    expect(applyUnion({ workspaceRoot: ws }).ok).toBe(true);
    expect(cursorHooks(ws).version).toBe(1);
    expect(cursorHooks(ws).hooks.sessionStart.map(scriptOf)).toEqual(["daily-pull-check.mjs", "rtk-check.mjs", "daily-fleet-check.mjs"]);
  });

  it("--check reports cursor: missing for a file or a script it lacks", () => {
    const ws = tmpDir("union-cursor-check-");
    seedOwnedDrivers(ws);
    touchConsumerScripts(ws);
    applyUnion({ workspaceRoot: ws });
    const live = cursorHooks(ws);
    live.hooks.sessionStart = live.hooks.sessionStart.filter((e: Entry) => !e.command.includes("daily-pull-check.mjs"));
    writeJson(ws, ".cursor/hooks.json", live);
    expect(checkUnion({ workspaceRoot: ws })).toEqual(["cursor: missing daily-pull-check.mjs"]);
    live.hooks.preToolUse = [];
    writeJson(ws, ".cursor/hooks.json", live);
    expect(checkUnion({ workspaceRoot: ws })).toEqual(
      expect.arrayContaining(OWNED_HOOKS.map((n) => `cursor: missing ${n}`)),
    );
    fs.rmSync(path.join(ws, ".cursor/hooks.json"));
    expect(checkUnion({ workspaceRoot: ws })).toContain("cursor: missing .cursor/hooks.json");
  });

  it("--check names a cursor command that does not find its script from the repo root", () => {
    const ws = tmpDir("union-cursor-stale-");
    seedOwnedDrivers(ws);
    touchConsumerScripts(ws);
    applyUnion({ workspaceRoot: ws });
    const live = cursorHooks(ws);
    live.hooks.postToolUse.push({ type: "command", command: "node scripts/validate.mjs --hook", matcher: "Write" });
    writeJson(ws, ".cursor/hooks.json", live);
    expect(checkUnion({ workspaceRoot: ws })).toContain(
      "cursor: validate.mjs hook command does not find its script from the repo root: run repo upgrade",
    );
  });
});

describe("hooks.jsonc matcher coverage", () => {
  const ssot = ssotOf(fs.readFileSync(path.join(repoRoot, ".rulesync/hooks.jsonc"), "utf8"));
  const matcherFor = (name: string): Set<string> => {
    const entry = ssot.hooks.preToolUse!.find((e: { command: string }) => e.command.endsWith(` hook ${name}`));
    return new Set(entry!.matcher!.split("|").map(eventKey));
  };
  const specs = Object.values(TOOLS).flatMap((m) => [...(m as Map<string, { kind: string; persistShared?: boolean }>)]);

  it("routes every tool the gate answers to the gate", () => {
    const gate = matcherFor(GATE);
    expect(specs.map(([key]) => key).filter((key) => !gate.has(key))).toEqual([]);
  });

  it("routes every shell tool and every persist-owned write to orchestrate-parent", () => {
    const parent = matcherFor(PARENT);
    const owned = specs.filter(([, spec]) => spec.kind === "bash" || (spec.kind === "write" && spec.persistShared));
    expect(owned.map(([key]) => key).filter((key) => !parent.has(key))).toEqual([]);
  });
});

describe("Claude worktree hooks", () => {
  const WORKTREE = hookCommand("worktree");
  const group = [{ hooks: [{ type: "command", command: WORKTREE, timeout: 60 }] }];

  it("hooks.jsonc routes Claude's WorktreeCreate and WorktreeRemove, and no other harness's, to the worktree hook", () => {
    const sot = ssotOf(fs.readFileSync(path.join(repoRoot, ".rulesync/hooks.jsonc"), "utf8"));
    const entry = [{ type: "command", command: WORKTREE, timeout: 60 }];
    expect(sot.claudecode.hooks).toEqual({ worktreeCreate: entry, worktreeRemove: entry });
    expect(JSON.stringify(sot.hooks)).not.toContain("hook worktree");
    const claude = readJson<ClaudeDoc>(repoRoot, ".claude/settings.json");
    expect(claude.hooks.WorktreeCreate).toEqual(group);
    expect(claude.hooks.WorktreeRemove).toEqual(group);
    for (const rel of [".codex/hooks.json", ".agents/hooks.json"]) {
      expect(JSON.stringify(readJson(repoRoot, rel)), rel).not.toContain("hook worktree");
    }
  });

  it("--check needs Claude's worktree hooks only when worktree.ts ships", () => {
    const ws = tmpDir("union-wt-");
    seedOwnedDrivers(ws);
    applyUnion({ workspaceRoot: ws });
    expect(checkUnion({ workspaceRoot: ws })).toEqual([]);
    fs.mkdirSync(path.join(ws, ".rulesync", "scripts"), { recursive: true });
    fs.writeFileSync(path.join(ws, ".rulesync", "scripts", "worktree.ts"), "");
    expect(checkUnion({ workspaceRoot: ws })).toContain("claude: missing worktree");
    const claude = readJson<ClaudeDoc>(ws, ".claude/settings.json");
    claude.hooks.WorktreeCreate = group;
    claude.hooks.WorktreeRemove = group;
    writeJson(ws, ".claude/settings.json", claude);
    applyUnion({ workspaceRoot: ws });
    expect(readJson<ClaudeDoc>(ws, ".claude/settings.json").hooks.WorktreeCreate).toEqual(group);
    expect(checkUnion({ workspaceRoot: ws })).toEqual([]);
  });
});
